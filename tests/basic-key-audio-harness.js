import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';

/** Test-only port/audio clock harness. It renders the production exported core;
 * it does not claim to instantiate a browser AudioWorklet or an audio device.
 */
export function basicKeyAudioHarness({sampleRate = 48000, autoMessages = true} = {}) {
  const toCore = [], toMain = [], listeners = new Set(), nodes = [];
  const context = {sampleRate, state: 'running', currentTime: 0, loaded: [], createGain() { return {gain: {value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }}, connect() {}, disconnect() {}}; }, audioWorklet: {async addModule(url) { context.loaded.push(url); }}, addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); }};
  let frame = 0;
  const nodeFactory = ({Core = BasicKeyAudioCore, automatic = autoMessages} = {}) => {
    const node = {connected: false, closed: false, connect() { this.connected = true; }, disconnect() { this.connected = false; }, port: {onmessage: null, start() {}, close() { node.closed = true; }, postMessage(message, transfer = []) { toCore.push([node, structuredClone(message, {transfer})]); if (automatic) queueMicrotask(() => deliverCore(node)); }}};
    node.core = new Core(sampleRate, {emit: (message, transfer = []) => { toMain.push([node, structuredClone(message, {transfer})]); if (automatic) queueMicrotask(() => deliverMain(node)); }});
    nodes.push(node); return node;
  };
  function drain(queue, selected) { const result = []; for (let i = 0; i < queue.length;) { if (!selected || queue[i][0] === selected) result.push(...queue.splice(i, 1)); else i++; } return result; }
  function deliverCore(selected = null) { for (const [node, message] of drain(toCore, selected)) node.core.handleMessage(message, frame); if (autoMessages && nodes.some(node => node.core.state === 'preparing')) queueMicrotask(prepareBlock); }
  function prepareBlock() { if (!nodes.some(node => node.core.state === 'preparing')) return; renderBlock(); if (nodes.some(node => node.core.state === 'preparing')) queueMicrotask(prepareBlock); }
  function finishPreparation() { while (nodes.some(node => node.core.state === 'preparing')) renderBlock(); }
  function deliverMain(selected = null) { for (const [node, message] of drain(toMain, selected)) if (!node.closed) node.port.onmessage?.({data: message}); }
  function renderBlock(size = 128) {
    const result = [];
    for (const node of nodes) { const channel = new Float32Array(size); node.core.process([channel], frame); result.push(channel); }
    frame += size; context.currentTime = frame / sampleRate; return result;
  }
  function setState(state) { context.state = state; for (const listener of listeners) listener(); }
  return {context, output: {}, nodes, nodeFactory, renderBlock, finishPreparation, deliverCore, deliverMain, toCore, toMain, setState, get frame() { return frame; }};
}
