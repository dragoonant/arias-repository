// Thin WebSocket client for the lobby / relay server.
// When there is no server (offline play), `connected` stays false and sends are ignored.

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  connect(timeoutMs = 4000) {
    if (this.connecting) return this.connecting;
    this.connecting = this._connect(timeoutMs).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  _connect(timeoutMs) {
    return new Promise((resolve) => {
      if (this.connected) return resolve(true);
      if (location.protocol === 'file:') return resolve(false);
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      try {
        this.ws = new WebSocket(url);
      } catch {
        return done(false);
      }
      const timer = setTimeout(() => done(false), timeoutMs);
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.id = msg.id;
          this.connected = true;
          clearTimeout(timer);
          done(true);
        }
        this.emit(msg.t, msg);
      };
      this.ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        clearTimeout(timer);
        done(false);
        if (was) this.emit('disconnect', {});
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
    });
  }

  send(msg) {
    if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // In-game message to everyone else in the room, a specific player id, or "host".
  relay(data, to) {
    this.send({ t: 'relay', to, data });
  }
}
