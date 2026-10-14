local ffi = require("ffi")
local bit = require("bit")

ffi.cdef[[
typedef struct { void* Sid; unsigned long Attributes; } DD_SID_ATTRIBUTES;
typedef struct { uintptr_t Internal; uintptr_t InternalHigh; unsigned long Offset;
                 unsigned long OffsetHigh; void* hEvent; } DD_OVERLAPPED;
void* GetCurrentProcess(void);
void* OpenProcess(unsigned long access, int inherit, unsigned long id);
int CloseHandle(void* handle);
unsigned long GetLastError(void);
void LocalFree(void* memory);
void Sleep(unsigned long milliseconds);
int OpenProcessToken(void* process, unsigned long access, void** token);
int GetTokenInformation(void* token, int type, void* buffer, unsigned long size, unsigned long* needed);
int ConvertSidToStringSidA(void* sid, char** result);
long RegGetValueW(void* key, const uint16_t* subkey, const uint16_t* value,
                 unsigned long flags, unsigned long* type, void* data, unsigned long* size);
unsigned long GetFileAttributesW(const uint16_t* path);
intptr_t ShellExecuteW(void* hwnd, const uint16_t* verb, const uint16_t* file,
                      const uint16_t* parameters, const uint16_t* directory, int show);
void* CreateFileW(const uint16_t* name, unsigned long access, unsigned long share,
                  void* attributes, unsigned long creation, unsigned long flags, void* template_file);
int SetNamedPipeHandleState(void* pipe, unsigned long* mode, void* count, void* timeout);
int GetNamedPipeServerProcessId(void* pipe, unsigned long* id);
void* CreateEventW(void* attributes, int manual, int state, const uint16_t* name);
unsigned long WaitForSingleObject(void* handle, unsigned long timeout);
int TransactNamedPipe(void* pipe, const void* input, unsigned long input_length,
                     void* output, unsigned long output_length, unsigned long* read, DD_OVERLAPPED* overlapped);
int GetOverlappedResult(void* pipe, DD_OVERLAPPED* overlapped, unsigned long* bytes, int wait);
int CancelIoEx(void* file, DD_OVERLAPPED* overlapped);
]]

local kernel = ffi.load("kernel32")
local security = ffi.load("advapi32")
local shell = ffi.load("shell32")
local invalid = ffi.cast("void*", ffi.cast("intptr_t", -1))
local function wide(value)
    -- All protocol names, arguments and registry key/value names are fixed ASCII.
    local output = ffi.new("uint16_t[?]", #value + 1)
    for i = 1, #value do output[i - 1] = value:byte(i) end
    return output
end
local function process_sid(process)
    local token = ffi.new("void*[1]")
    if security.OpenProcessToken(process, 8, token) == 0 then return nil end
    local needed = ffi.new("unsigned long[1]")
    security.GetTokenInformation(token[0], 1, nil, 0, needed)
    if needed[0] == 0 or needed[0] > 4096 then kernel.CloseHandle(token[0]); return nil end
    local buffer = ffi.new("uint8_t[?]", needed[0])
    local result
    if security.GetTokenInformation(token[0], 1, buffer, needed[0], needed) ~= 0 then
        local sid = ffi.new("char*[1]")
        if security.ConvertSidToStringSidA(ffi.cast("DD_SID_ATTRIBUTES*", buffer).Sid, sid) ~= 0 then
            result = ffi.string(sid[0]); kernel.LocalFree(sid[0])
        end
    end
    kernel.CloseHandle(token[0]); return result
end
local own_sid = process_sid(kernel.GetCurrentProcess())
local function trusted_server(pipe)
    local id = ffi.new("unsigned long[1]")
    if kernel.GetNamedPipeServerProcessId(pipe, id) == 0 then return false end
    local process = kernel.OpenProcess(0x1000, 0, id[0])
    if process == nil then return false end
    local sid = process_sid(process); kernel.CloseHandle(process)
    return sid ~= nil and sid == own_sid
end

local function launch(visible)
    local root = ffi.new("uint16_t[2048]")
    local size = ffi.new("unsigned long[1]", ffi.sizeof(root))
    local user_key = ffi.cast("void*", ffi.cast("intptr_t", -2147483647))
    if not visible then
        local version = ffi.new("uint16_t[64]")
        local version_size = ffi.new("unsigned long[1]", ffi.sizeof(version))
        if security.RegGetValueW(user_key,
            wide("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NightInjection"),
            wide("DisplayVersion"), 2, nil, version, version_size) ~= 0 or version[0] < 50 then return false end
    end
    if security.RegGetValueW(user_key,
        wide("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NightInjection"),
        wide("InstallLocation"), 2, nil, root, size) ~= 0 then return false end
    local length = 0; while length < 1900 and root[length] ~= 0 do length = length + 1 end
    local letter = root[0]
    if length < 3 or length >= 1900 or root[1] ~= 58 or (root[2] ~= 92 and root[2] ~= 47)
        or not ((letter >= 65 and letter <= 90) or (letter >= 97 and letter <= 122)) then return false end
    local suffix = "\\NightInjection.exe"
    for i = 1, #suffix do root[length + i - 1] = suffix:byte(i) end
    root[length + #suffix] = 0
    local attributes = kernel.GetFileAttributesW(root)
    if attributes == 0xffffffff or bit.band(attributes, 16) ~= 0 then return false end
    local result = shell.ShellExecuteW(nil, wide("open"), root,
        visible and nil or wide("--steam-worker"), nil, visible and 1 or 0)
    return tonumber(result) > 32
end

local function connect()
    if not own_sid then return nil end
    local name = wide("\\\\.\\pipe\\NightInjection.SteamBridge." .. own_sid)
    local pipe = kernel.CreateFileW(name, 0xc0000000, 0, nil, 3, 0x40000000, nil)
    if pipe == invalid then return nil end
    if not trusted_server(pipe) then kernel.CloseHandle(pipe); return nil end
    local mode = ffi.new("unsigned long[1]", 2)
    if kernel.SetNamedPipeHandleState(pipe, mode, nil, nil) == 0 then kernel.CloseHandle(pipe); return nil end
    return pipe
end

local function request(payload)
    if type(payload) ~= "string" or #payload > 16384 then error("Invalid IPC request") end
    local pipe = connect()
    if not pipe then
        if not launch(false) then return nil, "Install or upgrade Night Injection V2 to enable the background worker." end
        for _ = 1, 24 do kernel.Sleep(100); pipe = connect(); if pipe then break end end
    end
    if not pipe then return nil, "Background worker did not become available. Retry or repair Night Injection." end
    local output = ffi.new("char[65536]")
    local count = ffi.new("unsigned long[1]")
    local operation = ffi.new("DD_OVERLAPPED[1]")
    operation[0].hEvent = kernel.CreateEventW(nil, 1, 0, nil)
    if operation[0].hEvent == nil then kernel.CloseHandle(pipe); return nil, "Could not create IPC operation." end
    local ok = kernel.TransactNamedPipe(pipe, payload, #payload, output, ffi.sizeof(output), count, operation) ~= 0
    if not ok and kernel.GetLastError() == 997 then
        if kernel.WaitForSingleObject(operation[0].hEvent, 3000) == 0 then
            ok = kernel.GetOverlappedResult(pipe, operation, count, 0) ~= 0
        else
            kernel.CancelIoEx(pipe, operation)
            -- Cancellation completion must be drained before the OVERLAPPED buffer is released.
            kernel.GetOverlappedResult(pipe, operation, count, 1)
        end
    end
    local result = ok and count[0] > 0 and ffi.string(output, count[0]) or nil
    kernel.CloseHandle(operation[0].hEvent); kernel.CloseHandle(pipe)
    if result then return result end
    return nil, "Background worker disconnected or timed out. Reopen or retry to reconnect."
end
return { request = request, open_app = function() return launch(true) end }
