import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';

/** Test-only port/audio clock harness. It renders the production exported core;
 * it does not claim to instantiate a browser AudioWorklet or an audio device.
 */
export function basicKeyAudioHarness({sampleRate = 48000, autoMessages = true} = {}) {
  const toCore = [], toMain = [], listeners = new Set(), nodes = [];
  const context = {sampleRate, state: 'running', currentTime: 0, loaded: [], createGain() { return {gain: {value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }}, connect() {}, disconnect() {}}; }, audioWorklet: {async addModule(url) { context.loaded.push(url); }}, addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); }};
  let frame = 0;
  const nodeFactory = () => {
    const node = {connected: false, closed: false, connect() { this.connected = true; }, disconnect() { this.connected = false; }, port: {onmessage: null, start() {}, close() { node.closed = true; }, postMessage(message, transfer = []) { toCore.push([node, structuredClone(message, {transfer})]); if (autoMessages) queueMicrotask(deliverCore); }}};
    node.core = new BasicKeyAudioCore(sampleRate, {emit: (message, transfer = []) => { toMain.push([node, structuredClone(message, {transfer})]); if (autoMessages) queueMicrotask(deliverMain); }});
    nodes.push(node); return node;
  };
  function deliverCore() { for (const [node, message] of toCore.splice(0)) node.core.handleMessage(message, frame); if (autoMessages && nodes.some(node => node.core.state === 'preparing')) queueMicrotask(prepareBlock); }
  function prepareBlock() { if (!nodes.some(node => node.core.state === 'preparing')) return; renderBlock(); if (nodes.some(node => node.core.state === 'preparing')) queueMicrotask(prepareBlock); }
  function finishPreparation() { while (nodes.some(node => node.core.state === 'preparing')) renderBlock(); }
  function deliverMain() { for (const [node, message] of toMain.splice(0)) if (!node.closed) node.port.onmessage?.({data: message}); }
  function renderBlock(size = 128) {
    const result = [];
    for (const node of nodes) { const channel = new Float32Array(size); node.core.process([channel], frame); result.push(channel); }
    frame += size; context.currentTime = frame / sampleRate; return result;
  }
  function setState(state) { context.state = state; for (const listener of listeners) listener(); }
  return {context, output: {}, nodes, nodeFactory, renderBlock, finishPreparation, deliverCore, deliverMain, toCore, toMain, setState, get frame() { return frame; }};
}
