/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS harness for the transpiled provider. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real provider with a deterministic hook scheduler. In particular,
// simulate a child's mount save BEFORE the parent's pending passive effects.
function harness(harnessOptions = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let account = { userId: 'a', status: 'active', isAdmin: false };
  let cloud = { email_templates: [{ id: 'personal' }], todos: ['existing'] };
  let fail = false;
  const writes = [];
  const errors = [];
  const storage = new Map(harnessOptions.storageEntries || []);
  const windowListeners = new Map();
  const documentListeners = new Map();
  const ensureSession = () => {};
  const changed = (a, b) => !a || a.some((v, i) => v !== b[i]);
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = value; }];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] ||= { current: initial };
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const sandboxModule = { exports: {} };
  const source = fs.readFileSync(require.resolve('../src/components/user-data-provider.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module: sandboxModule, exports: sandboxModule.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.includes('auth-provider')) return { useAuth: () => ({ account, ensureSession }) };
      if (name.includes('session-recovery')) return { runSafeRequestWithSessionRecovery: (_, request) => request() };
      if (name === 'sonner') return { toast: { error: message => errors.push(message) } };
      return {};
    },
    window: {
      localStorage: {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
        key: index => Array.from(storage.keys())[index] || null,
        get length() { return storage.size; },
      },
      addEventListener: (name, listener) => windowListeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (windowListeners.get(name) === listener) windowListeners.delete(name);
      },
    },
    document: {
      visibilityState: 'visible',
      addEventListener: (name, listener) => documentListeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (documentListeners.get(name) === listener) documentListeners.delete(name);
      },
    },
    fetch: async (_, requestOptions = {}) => {
      if (requestOptions.method === 'PUT') writes.push(JSON.parse(requestOptions.body));
      return {
        ok: !fail,
        status: fail ? 400 : 200,
        json: async () => ({
          success: !fail,
          data: cloud,
          error: 'mock failure',
          meta: { updatedAtByKey: harnessOptions.updatedAtByKey || {} },
        }),
      };
    },
  });
  return {
    render() { cursor = 0; return sandboxModule.exports.UserDataProvider({ children: null }); },
    flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); },
    switchAccount() { account = { ...account, userId: 'b' }; cloud = { todos: ['b'] }; },
    fail() { fail = true; }, writes, errors,
    recover() { fail = false; },
    online() { windowListeners.get('online')?.(); },
    storage,
  };
}

test('hydration followed by child saves preserves personal templates and sequential updates', async () => {
  const h = harness();
  h.render(); h.flush(); await h.settle();
  const store = h.render().props.value;
  store.save('email_generation_tasks', ['interrupted']);
  store.update('todos', items => [...items, 'new']);
  h.flush(); await h.settle();
  const result = h.render().props.value.data;
  assert.equal(result.email_templates[0].id, 'personal');
  assert.equal(result.todos.join(','), 'existing,new');
  assert.equal(result.email_generation_tasks[0], 'interrupted');
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes.every(write => write.key !== 'email_templates'));
});

test('account replacement clears the previous merge source', async () => {
  const h = harness();
  h.render(); h.flush(); await h.settle(); h.render(); h.flush();
  h.switchAccount(); h.render(); h.flush(); await h.settle();
  h.render().props.value.save('email_generation_tasks', []);
  h.flush(); await h.settle();
  const data = h.render().props.value.data;
  assert.equal(data.email_templates, undefined);
  assert.equal(data.todos[0], 'b');
});

test('failed saves still report an error without removing unrelated templates', async () => {
  const h = harness();
  h.render(); h.flush(); await h.settle();
  const store = h.render().props.value;
  h.fail(); store.save('todos', []); h.flush(); await h.settle();
  assert.equal(h.errors[0], '任务暂未同步云端，系统会在网络恢复后自动重试。');
  assert.equal(h.render().props.value.data.email_templates[0].id, 'personal');
});

test('failed todo saves remain queued locally and retry silently when the network returns', async () => {
  const h = harness();
  h.render(); h.flush(); await h.settle();
  h.fail();
  h.render().props.value.update('todos', items => [...items, 'offline']);
  h.flush(); await h.settle();
  assert.equal(Array.from(h.storage.keys()).some(key => key.includes('todo-cloud-outbox')), true);
  assert.equal(h.writes.length, 1);

  h.recover();
  h.online();
  await h.settle();
  assert.equal(h.writes.length, 2);
  assert.equal(Array.from(h.storage.keys()).some(key => key.includes('todo-cloud-outbox')), false);
  assert.equal(h.errors.length, 1);
});

test('a newer pending todo snapshot survives reload and is uploaded before it is cleared', async () => {
  const pending = {
    id: 'pending-1',
    queuedAt: '2026-09-22T10:00:00.000Z',
    data: ['existing', 'pending'],
  };
  const h = harness({
    storageEntries: [['influencer-board-todo-cloud-outbox-v1:a', JSON.stringify(pending)]],
    updatedAtByKey: { todos: '2026-09-22T09:00:00.000Z' },
  });
  h.render(); h.flush(); await h.settle();
  assert.equal(h.render().props.value.data.todos.join(','), 'existing,pending');
  assert.deepEqual(h.writes[0], { key: 'todos', data: ['existing', 'pending'] });
  assert.equal(h.storage.has('influencer-board-todo-cloud-outbox-v1:a'), false);
});
