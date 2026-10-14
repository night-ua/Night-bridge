import { attachBridge } from './store-bridge.js';
import { createTransport } from './transport.js';

export default function main() {
    // Starlight generates the backend proxy from the annotated Lua export.
    attachBridge(window, createTransport(backend));
}
