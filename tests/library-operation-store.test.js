import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryOperationStore, LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';
const storage = () => { const values = new Map(); return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}; };
const record = id => ({library_id: `library-${id}`, operation_id: `operation-${id}`, phase: 'submitted'});

test('operation recovery survives a new model and stays tied to one library', () => {
  const local = storage(), first = new LibraryOperationStore({storage: local});
  first.put(record('a')); first.put(record('b'));
  const reopened = new LibraryOperationStore({storage: local});
  assert.deepEqual(reopened.get('library-a'), record('a'));
  assert.deepEqual(reopened.get('library-b'), record('b'));
  const copy = reopened.get('library-a'); copy.phase = 'changed';
  assert.equal(reopened.get('library-a').phase, 'submitted');
});

test('unavailable, full, corrupt or unconfirmed persistence fails before native submission', () => {
  for (const local of [{}, {getItem: () => null, setItem() {}}, {getItem() { throw Error('Denied'); }}]) {
    const store = new LibraryOperationStore({storage: local});
    assert.throws(() => store.put(record('a')), {code: 'library_operation_storage'});
  }
  const local = storage(), store = new LibraryOperationStore({storage: local});
  for (let index = 0; index < 16; index++) store.put(record(index));
  assert.throws(() => store.put(record(17)), {code: 'library_operation_storage'});
  assert.equal(store.get('library-0').operation_id, 'operation-0', 'Pending identities never evicted to make room');
  assert.throws(() => store.put({...record(0), overflow: 'x'.repeat(512 * 1024)}), {code: 'library_operation_storage'});
  local.setItem(LIBRARY_OPERATION_STORAGE_KEY, '{broken');
  assert.throws(() => store.get('library-0'), {code: 'library_operation_storage'});
});
