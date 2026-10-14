local millennium = require("millennium")
local json = require("json")
local ipc = require("windows-ipc")

-- Only named-pipe operations and explicit app opening are exposed to the webview.
local defaults = { automaticApply = false, colorMode = "native", customColor = "#FF6A00", version = 2 }
local allowed = { start = true, status = true, preview = true, apply = true, cancel = true, settings = true }

---@ffi
---@return string
function get_bridge_preferences()
    local preferences = millennium.config.get("preferences")
    if type(preferences) ~= "table" then preferences = defaults end
    if preferences.colorMode == "automatic" then
        preferences.colorMode = "native"
        millennium.config.set("preferences", preferences)
    end
    return json.encode(preferences)
end

---@ffi
---@param request_json string
---@return string
function bridge_request(request_json)
    if type(request_json) ~= "string" or #request_json > 16384 then return json.encode({ ok = false, error = "VALIDATION_FAILED" }) end
    local parsed_ok, request = pcall(json.decode, request_json)
    if not parsed_ok or type(request) ~= "table" or not allowed[request.op] then return json.encode({ ok = false, error = "VALIDATION_FAILED" }) end
    if request.appId ~= nil and (type(request.appId) ~= "string" or not request.appId:match("^[1-9][0-9]*$")
        or #request.appId > 10 or tonumber(request.appId) > 4294967295) then return json.encode({ ok = false, error = "VALIDATION_FAILED" }) end
    local ok, result, failure = pcall(ipc.request, request_json)
    if not ok or not result then return json.encode({ ok = false, error = "WORKER_UNAVAILABLE", message = failure or "Could not communicate with the background worker." }) end
    local decode_ok, reply = pcall(json.decode, result)
    if not decode_ok or type(reply) ~= "table" or type(reply.ok) ~= "boolean" then
        return json.encode({ ok = false, error = "WORKER_UNAVAILABLE", message = "Invalid worker response." })
    end
    if type(reply.settings) == "table" then millennium.config.set("preferences", reply.settings) end
    return result
end

---@ffi
---@return boolean
function open_app()
    return ipc.open_app()
end

return {
    on_load = function() millennium.ready() end,
    on_unload = function() end,
}
