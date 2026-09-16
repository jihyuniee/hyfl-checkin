/* Acknowledged delivery. An interrupted request may already have reached Apps Script. */
(function (root) {
  'use strict';
  class CheckinDelivery {
    constructor({storage, send, online = () => true, onEvent = () => {}, key = 'hyfl:outbox'}) {
      this.storage = storage; this.send = send; this.online = online;
      this.onEvent = onEvent; this.key = key; this.running = false; this.items = [];
      this.storageError = false;
      try {
        const saved = JSON.parse(storage.getItem(key) || '[]');
        if (!Array.isArray(saved) || saved.some(x => !this.valid(x))) throw Error('invalid outbox');
        this.items = saved.map(x => ({...x, delivery: x.delivery === 'waiting' ? 'waiting' : 'uncertain'}));
      } catch (_) { this.storageError = true; }
    }
    valid(x) {
      return x && typeof x.scanId === 'string' && x.scanId.length > 0 &&
        typeof x.token === 'string' && x.token.trim().length >= 3 &&
        Number.isInteger(x.count) && x.count >= 1 && x.count <= 10;
    }
    persist() {
      try { this.storage.setItem(this.key, JSON.stringify(this.items)); return true; }
      catch (_) { this.storageError = true; this.emit('storage-error'); return false; }
    }
    emit(type, item, response) {
      try { this.onEvent({type, item, response, pending: this.items.length}); } catch (_) {}
    }
    enqueue(payload) {
      if (!this.valid(payload)) throw Error('QR 또는 인원을 확인해 주세요.');
      if (this.storageError) throw Error('기기 저장 공간을 확인해 주세요. 자동 전송을 중지했습니다.');
      const existing = this.items.find(x => x.token === payload.token);
      if (existing) { this.emit(existing.delivery, existing); return existing; }
      const item = {...payload, delivery: 'waiting'};
      this.items.push(item);
      if (!this.persist()) { this.items.pop(); throw Error('기기에 전송 내역을 보관하지 못했습니다.'); }
      this.emit('waiting', item); return item;
    }
    async flush() {
      if (this.running || this.storageError || !this.online()) return;
      this.running = true;
      try {
        let item;
        while (this.online() && !this.storageError && (item = this.items.find(x => x.delivery === 'waiting'))) {
          item.delivery = 'sending';
          // Persist before POST. A reload during POST must never silently replay it.
          if (!this.persist()) { item.delivery = 'uncertain'; break; }
          this.emit('sending', item);
          try {
            const {ok, data} = await this.send(item);
            if (!ok || !data || data.ok !== true) {
              item.delivery = 'uncertain'; this.persist(); this.emit('uncertain', item, data); continue;
            }
            if (data.msg === 'deduped' || data.duplicate === true || data.already === true || data.status === 'already') {
              // Legacy deduped responses prove suppression, not durable attendance.
              item.delivery = 'uncertain'; this.persist(); this.emit('deduped', item, data); continue;
            }
            this.items = this.items.filter(x => x.scanId !== item.scanId);
            this.persist();
            this.emit('confirmed', item, data);
          } catch (_) {
            item.delivery = 'uncertain'; this.persist(); this.emit('uncertain', item);
          }
        }
      } finally { this.running = false; }
    }
    resolve(id, recorded) {
      if (this.storageError) throw Error('기기 저장 공간을 먼저 확인해 주세요.');
      const item = this.items.find(x => x.scanId === id);
      if (!item || item.delivery === 'sending') return;
      if (recorded) this.items = this.items.filter(x => x.scanId !== id);
      else item.delivery = 'waiting';
      if (!this.persist()) throw Error('확인 결과를 저장하지 못했습니다.');
      this.emit('resolved', item); return this.flush();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = CheckinDelivery;
  else root.CheckinDelivery = CheckinDelivery;
})(typeof globalThis !== 'undefined' ? globalThis : this);
