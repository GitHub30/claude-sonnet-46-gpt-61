/** ECS World - manages entities, components, and systems */
export class World {
  constructor() {
    this._nextId = 1;
    this._entities = new Map();       // id → Set<componentName>
    this._components = new Map();     // componentName → Map<entityId, componentData>
    this._systems = [];               // [{name, query:string[], fn, priority}]
    this._toDestroy = new Set();
    this._tags = new Map();           // tag → Set<entityId>
    this._entityTags = new Map();     // entityId → Set<tag>
  }

  // --- Entity management ---
  createEntity(tag = null) {
    const id = this._nextId++;
    this._entities.set(id, new Set());
    this._entityTags.set(id, new Set());
    if (tag) this.addTag(id, tag);
    return id;
  }

  destroyEntity(id) { this._toDestroy.add(id); }

  _flushDestroy() {
    for (const id of this._toDestroy) {
      const comps = this._entities.get(id);
      if (!comps) continue;
      for (const name of comps) {
        const store = this._components.get(name);
        if (store) store.delete(id);
      }
      const tags = this._entityTags.get(id);
      if (tags) {
        for (const t of tags) {
          const s = this._tags.get(t);
          if (s) s.delete(id);
        }
      }
      this._entities.delete(id);
      this._entityTags.delete(id);
    }
    this._toDestroy.clear();
  }

  entityExists(id) { return this._entities.has(id) && !this._toDestroy.has(id); }

  // --- Tag management ---
  addTag(id, tag) {
    if (!this._tags.has(tag)) this._tags.set(tag, new Set());
    this._tags.get(tag).add(id);
    this._entityTags.get(id)?.add(tag);
  }

  removeTag(id, tag) {
    this._tags.get(tag)?.delete(id);
    this._entityTags.get(id)?.delete(tag);
  }

  getByTag(tag) { return this._tags.get(tag) || new Set(); }

  hasTag(id, tag) { return this._entityTags.get(id)?.has(tag) ?? false; }

  // --- Component management ---
  addComponent(id, name, data) {
    if (!this._components.has(name)) this._components.set(name, new Map());
    this._components.get(name).set(id, data);
    this._entities.get(id)?.add(name);
    return data;
  }

  removeComponent(id, name) {
    this._components.get(name)?.delete(id);
    this._entities.get(id)?.delete(name);
  }

  getComponent(id, name) { return this._components.get(name)?.get(id); }

  hasComponent(id, name) { return this._components.get(name)?.has(id) ?? false; }

  // --- Query entities with all specified components ---
  query(...componentNames) {
    const result = [];
    if (componentNames.length === 0) return result;

    // Start from smallest component store
    let smallest = null, minSize = Infinity;
    for (const name of componentNames) {
      const s = this._components.get(name);
      if (!s) return result;
      if (s.size < minSize) { minSize = s.size; smallest = s; }
    }

    for (const id of smallest.keys()) {
      if (this._toDestroy.has(id)) continue;
      let match = true;
      for (const name of componentNames) {
        if (!this._components.get(name)?.has(id)) { match = false; break; }
      }
      if (match) result.push(id);
    }
    return result;
  }

  // --- System management ---
  addSystem(name, componentNames, fn, priority = 0) {
    this._systems.push({ name, componentNames, fn, priority });
    this._systems.sort((a, b) => a.priority - b.priority);
  }

  removeSystem(name) {
    this._systems = this._systems.filter(s => s.name !== name);
  }

  // --- Main update ---
  update(dt, context = {}) {
    for (const sys of this._systems) {
      const entities = this.query(...sys.componentNames);
      sys.fn(entities, dt, context, this);
    }
    this._flushDestroy();
  }

  // --- Utility: get all components of an entity ---
  getAll(id) {
    const result = {};
    const comps = this._entities.get(id);
    if (!comps) return result;
    for (const name of comps) {
      result[name] = this._components.get(name)?.get(id);
    }
    return result;
  }
}
