      import * as THREE from "three";

      /* ================================================================
         0. UTILITIES
         ================================================================ */
      const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
      const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
      const easeOutBack = (u) => { const c = 1.70158, x = u - 1; return 1 + (c + 1) * x * x * x + c * x * x; };
      const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
      const hex = (n) => "#" + n.toString(16).padStart(6, "0");
      function mulberry32(a) {
        return function () {
          a |= 0; a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

      function mergeBoxes(boxes) {
        const base = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
        const bp = base.getAttribute("position").array, bn = base.getAttribute("normal").array, n = bp.length;
        const pos = new Float32Array(n * boxes.length), nor = new Float32Array(n * boxes.length);
        boxes.forEach((b, i) => {
          for (let j = 0; j < n; j += 3) {
            const o = i * n + j;
            pos[o] = bp[j] * b.sx + b.x; pos[o + 1] = bp[j + 1] * b.sy + b.y; pos[o + 2] = bp[j + 2] * b.sz + b.z;
            nor[o] = bn[j]; nor[o + 1] = bn[j + 1]; nor[o + 2] = bn[j + 2];
          }
        });
        base.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        return g;
      }
      const FONT = {
        0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
        3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
        6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "001", "001", "001"], 8: ["111", "101", "111", "101", "111"],
        9: ["111", "101", "111", "001", "111"], "%": ["101", "001", "010", "100", "101"],
      };
      function textGeometry(str, px, depth) {
        const boxes = []; let cx = 0;
        for (const ch of str) {
          const rows = FONT[ch]; if (!rows) { cx += px * 2; continue; }
          rows.forEach((row, r) => { for (let c = 0; c < 3; c++) if (row[c] === "1") boxes.push({ x: cx + c * px + px / 2, y: (4 - r) * px + px / 2, z: 0, sx: px * 1.03, sy: px * 1.03, sz: depth }); });
          cx += 4 * px;
        }
        const w = cx - px, h = 5 * px;
        for (const b of boxes) { b.x -= w / 2; b.y -= h / 2; }
        return { geo: mergeBoxes(boxes), w, h };
      }
      const MARKER_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 1).normalize(), new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(0, 1, 0)));
      const WHITE = new THREE.Color(0xffffff);
      const CAM_OFF = { x: -9, y: 13, z: -9 };

      /* ================================================================
         1. SKINS (Line Skins)
         ================================================================ */
      const SKINS = [
        { id: "default", name: "Classic", color: null, cost: 0 },
        { id: "light", name: "Light", color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.65, cost: 30 },
        { id: "fire", name: "Ball of Fire", color: 0xff4d26, cost: 50 },
        { id: "gold", name: "Golden", color: 0xffd166, cost: 75 },
        { id: "neon", name: "Cyber Neon", color: 0x4cc9f0, cost: 100 },
        { id: "ruby", name: "Ruby Gem", color: 0xff2a7a, cost: 150 },
      ];

      /* ================================================================
         2. AUDIO ENGINE — Rich layered synthesis
         ================================================================ */
      class MusicEngine {
        constructor() {
          this.ctx = null; this.song = null; this.timer = null; this.playing = false; this.muted = false;
          this.musicOn = true; this.sfxOn = true; this.curVol = 0.55; this.beatSec = 0.5; this.startTime = 0; this.step = 0; this.next = 0;
        }
        unlock() { if (!this.ctx) this.init(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
        init() {
          const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
          const ctx = (this.ctx = new Ctx());
          const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.attack.value = 0.004; comp.release.value = 0.2; comp.connect(ctx.destination);
          this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(comp);
          this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0001; this.musicBus.connect(this.master);
          this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0.0001; this.sfxBus.connect(this.master);

          const delay = ctx.createDelay(1); delay.delayTime.value = 0.24;
          const fb = ctx.createGain(); fb.gain.value = 0.35;
          const damp = ctx.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 2600;
          const wet = ctx.createGain(); wet.gain.value = 0.45;
          this.echoMusic = ctx.createGain(); this.echoMusic.gain.value = this.musicOn ? 1 : 0; this.echoMusic.connect(delay);
          this.echoSfx = ctx.createGain(); this.echoSfx.gain.value = this.sfxOn ? 1 : 0; this.echoSfx.connect(delay);
          delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet); wet.connect(this.master);

          const irLen = Math.floor(ctx.sampleRate * 2.1);
          const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
          for (let ch = 0; ch < 2; ch++) {
            const data = ir.getChannelData(ch);
            for (let i = 0; i < irLen; i++) {
              const decay = Math.pow(1 - i / irLen, 2.7);
              data[i] = (Math.random() * 2 - 1) * decay;
            }
          }
          const convolver = ctx.createConvolver(); convolver.buffer = ir;
          const reverbWet = ctx.createGain(); reverbWet.gain.value = 0.18;
          convolver.connect(reverbWet); reverbWet.connect(this.master);
          this.musicRev = ctx.createGain(); this.musicRev.gain.value = this.musicOn ? 0.22 : 0; this.musicRev.connect(convolver);
          this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = this.sfxOn ? 0.32 : 0; this.sfxRev.connect(convolver);

          const len = ctx.sampleRate; this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        start(song, beatOffset = 0, vol = 0.55, tempo = 1) {
          if (!this.ctx) return;
          if (this.ctx.state === "suspended") this.ctx.resume();
          this.song = song; this.beatSec = 60 / (song.bpm * tempo); this.curVol = vol;
          const now = this.ctx.currentTime;
          this.startTime = now + 0.06 - beatOffset * this.beatSec;
          this.step = ((Math.round(beatOffset * 4) % 64) + 64) % 64;
          this.next = now + 0.06;
          this.musicBus.gain.cancelScheduledValues(now);
          this.musicBus.gain.setTargetAtTime(this.musicOn ? vol : 0.0001, now, 0.05);
          if (!this.playing) { this.playing = true; this.timer = setInterval(() => this.schedule(), 30); }
        }
        stop(fade = 0.3) {
          if (!this.ctx) return;
          this.playing = false; clearInterval(this.timer); this.timer = null;
          const now = this.ctx.currentTime;
          this.musicBus.gain.cancelScheduledValues(now); this.musicBus.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fade / 3));
        }
        setMuted(m) { this.muted = m; if (!this.ctx) return; const now = this.ctx.currentTime; this.master.gain.cancelScheduledValues(now); this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.02); }
        setMusicOn(on) { this.musicOn = on; if (!this.ctx) return; const now = this.ctx.currentTime; this.musicBus.gain.cancelScheduledValues(now); this.musicBus.gain.setTargetAtTime(on && this.playing ? this.curVol : 0.0001, now, 0.05); this.echoMusic.gain.setTargetAtTime(on ? 1 : 0, now, 0.05); this.musicRev.gain.setTargetAtTime(on ? 0.22 : 0, now, 0.05); }
        setSfxOn(on) { this.sfxOn = on; if (!this.ctx) return; const now = this.ctx.currentTime; this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0.0001, now, 0.02); this.echoSfx.gain.setTargetAtTime(on ? 1 : 0, now, 0.02); this.sfxRev.gain.setTargetAtTime(on ? 0.32 : 0, now, 0.02); }
        suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); }
        resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
        setTempo(tempo) {
          if (!this.song) return;
          this.beatSec = 60 / (this.song.bpm * tempo);
        }
        getBeat() { if (!this.ctx || !this.playing) return -1; return (this.ctx.currentTime - this.startTime) / this.beatSec; }
        pulse() { const b = this.getBeat(); if (b < 0) return 0; const f = b - Math.floor(b); return Math.pow(1 - f, 3); }

        schedule() {
          if (!this.ctx || !this.song) return;
          const now = this.ctx.currentTime;
          if (this.next < now - 0.12) this.next = now + 0.05;
          while (this.next < now + 0.16) { this.playStep(this.step, this.next); this.next += this.beatSec / 4; this.step = (this.step + 1) % 64; }
        }
        playStep(step, t) {
          const S = this.song, bar = (step >> 4) % 4, s = step & 15, ch = S.chords[bar];
          if (S.pad && s === 0) this.pad(ch, t);
          if (s === 0 || s === 8) this.chordStab(ch, t, s === 0 ? 0.042 : 0.026);
          if (S.drums) {
            const d = S.drums;
            if (d.kick.indexOf(s) !== -1) this.kick(t, d.kickVol);
            if (d.snare.indexOf(s) !== -1) this.snare(t, d.snareVol);
            if (d.hat.indexOf(s) !== -1) this.hat(t, d.open && d.open.indexOf(s) !== -1, d.hatVol);
            else if (s % 2 === 1) this.hat(t, false, 0.012);
          }
          if (S.bass) for (const b of S.bass) if (b[0] === s) this.bassNote(ch.b + b[1], t, b[2]);
          if (S.arp && s % 2 === 0) this.note(S.arpVoice || "pluck", ch.t[S.arp[(s >> 1) % S.arp.length]] + 12, t, this.beatSec * 0.5, S.arpVol || 0.04, false);
          if (S.melody) { const ms = step % 32; for (const m of S.melody) if (m[0] === ms) this.note(S.voice, m[1], t, m[2] * this.beatSec, S.melVol || 0.12, true); }
          if (s === 7 || s === 15) this.note("bell", ch.t[(bar + (s === 15 ? 1 : 0)) % 3] + 24, t, this.beatSec, 0.016, true);
        }
        env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
        osc(type, f, det = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; return o; }

        note(voice, m, t, dur, vol, echo) {
          const ctx = this.ctx, f = midi(m);
          const out = ctx.createGain(); out.gain.value = 1; out.connect(this.musicBus); out.connect(this.musicRev); if (echo) out.connect(this.echoMusic);
          let stopAt;
          if (voice === "piano") {
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.connect(out);
            const d = Math.max(0.55, dur * 1.6); stopAt = t + d + 0.05;
            for (const p of [["triangle", 1, 1, d], ["sine", 2, 0.35, d * 0.5], ["sine", 3.01, 0.12, d * 0.25]]) {
              const o = this.osc(p[0], f * p[1]); const g = ctx.createGain(); this.env(g, t, 0.005, p[3], vol * p[2]);
              o.connect(g); g.connect(lp); o.start(t); o.stop(stopAt);
            }
          } else if (voice === "marimba") {
            const o1 = this.osc("sine", f), o2 = this.osc("sine", f * 4), g1 = ctx.createGain(), g2 = ctx.createGain();
            this.env(g1, t, 0.004, 0.42, vol); this.env(g2, t, 0.002, 0.08, vol * 0.3);
            o1.connect(g1); o2.connect(g2); g1.connect(out); g2.connect(out); stopAt = t + 0.5; o1.start(t); o2.start(t); o1.stop(stopAt); o2.stop(stopAt);
          } else if (voice === "bell") {
            const d = Math.max(1.0, dur * 2); stopAt = t + d + 0.05;
            for (const p of [[1, 1], [2.76, 0.32], [5.4, 0.1]]) {
              const o = this.osc("sine", f * p[0]); const g = ctx.createGain(); this.env(g, t, 0.003, d * (p[0] > 2 ? 0.45 : 1), vol * p[1] * 0.75);
              o.connect(g); g.connect(out); o.start(t); o.stop(stopAt);
            }
          } else {
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2800, t); lp.frequency.exponentialRampToValueAtTime(480, t + 0.25); lp.connect(out);
            const o1 = this.osc("sawtooth", f, -5), o2 = this.osc("square", f, 5), g = ctx.createGain(); const d = Math.max(0.22, dur * 0.9);
            this.env(g, t, 0.003, d, vol * 0.6); o1.connect(g); o2.connect(g); g.connect(lp); stopAt = t + d + 0.03; o1.start(t); o2.start(t); o1.stop(stopAt); o2.stop(stopAt);
          }
        }

        pad(ch, t) {
          const ctx = this.ctx, lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800; lp.Q.value = 0.4;
          const g = ctx.createGain(); const bar = this.beatSec * 4;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.5); g.gain.setValueAtTime(0.045, t + bar * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 0.05);
          lp.connect(g); g.connect(this.musicBus);
          ch.t.forEach((n, i) => { const o = this.osc("triangle", midi(n), (i - 1) * 7); o.connect(lp); o.start(t); o.stop(t + bar + 0.1); });
        }
        chordStab(ch, t, vol) {
          const ctx = this.ctx, lp = ctx.createBiquadFilter();
          lp.type = "lowpass"; lp.frequency.setValueAtTime(2100, t); lp.frequency.exponentialRampToValueAtTime(520, t + 0.28);
          const out = ctx.createGain(); out.gain.value = 1; lp.connect(out); out.connect(this.musicBus); out.connect(this.musicRev);
          ch.t.forEach((n, i) => {
            const o = this.osc(i === 1 ? "triangle" : "sine", midi(n + 12), (i - 1) * 4);
            const g = ctx.createGain(); this.env(g, t, 0.008, 0.28, vol * (i === 1 ? 1 : 0.72));
            o.connect(g); g.connect(lp); o.start(t); o.stop(t + 0.32);
          });
        }
        kick(t, v = 0.45) { const ctx = this.ctx, o = this.osc("sine", 150), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.22); }
        snare(t, v = 0.16) { const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + 0.18); }
        hat(t, open, v = 0.05) { const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500; const g = ctx.createGain(); const d = open ? 0.1 : 0.035; g.gain.setValueAtTime(v * (open ? 1.3 : 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + d + 0.02); }
        bassNote(n, t, v) { const ctx = this.ctx, o = this.osc("sawtooth", midi(n)), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(680, t); f.frequency.exponentialRampToValueAtTime(170, t + 0.22); const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.3); }

        /* Sound effects synthesis */
        tapClick() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          // Dual woodblock click + subtle tone
          const s = ctx.createBufferSource(); s.buffer = this.noise;
          const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1650; f.Q.value = 3.5;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
          s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.04);
          const o = this.osc("sine", 880), og = ctx.createGain(); og.gain.setValueAtTime(0.08, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
          o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.05);
        }
        gem() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const o = this.osc("sine", 880), g = ctx.createGain();
          o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.07); o.frequency.exponentialRampToValueAtTime(2640, t + 0.15);
          g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          o.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx); g.connect(this.sfxRev); o.start(t); o.stop(t + 0.3);
        }
        crown() {
          if (!this.ctx) return; const ctx = this.ctx;
          [784, 988, 1175, 1568].forEach((f, i) => {
            const t = ctx.currentTime + i * 0.08, o = this.osc("triangle", f), g = ctx.createGain();
            this.env(g, t, 0.01, 0.42, 0.14); o.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx); g.connect(this.sfxRev); o.start(t); o.stop(t + 0.5);
          });
        }
        complete() {
          if (!this.ctx) return; const ctx = this.ctx;
          [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.noteSfx(f, ctx.currentTime + i * 0.11, 0.9, 0.14));
        }
        unlockJingle() {
          if (!this.ctx) return; const ctx = this.ctx;
          [880, 1109, 1319].forEach((f, i) => this.noteSfx(f, ctx.currentTime + i * 0.1, 0.6, 0.1));
        }
        noteSfx(f, t, d, v) {
          const ctx = this.ctx, o = this.osc("triangle", f), o2 = this.osc("sine", f * 2), g = ctx.createGain();
          this.env(g, t, 0.01, d, v); o.connect(g); o2.connect(g); g.connect(this.sfxBus); g.connect(this.echoSfx);
          o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
        }
        crash() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.4);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.5);
          const o = this.osc("sawtooth", 160), og = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(40, t + 0.4); og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.5);
        }
        fall() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.8);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.85); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.9);
          const o = this.osc("sine", 320), og = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(55, t + 0.8); og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.85);
        }
        thunder(delay = 0.5) {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + delay;
          const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.6);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8); s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 1.9);
          const o = this.osc("sine", 48), og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.18, t + 0.08); og.gain.exponentialRampToValueAtTime(0.001, t + 1.4); o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 1.5);
        }
        uiClick() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, o = this.osc("sine", 960), g = ctx.createGain();
          g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.06);
        }
        deny() {
          if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
          [220, 196].forEach((f, i) => { const o = this.osc("square", f), g = ctx.createGain(); const s = t + i * 0.09; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.05, s + 0.01); g.gain.exponentialRampToValueAtTime(0.001, s + 0.09); o.connect(g); g.connect(this.sfxBus); o.start(s); o.stop(s + 0.1); });
        }
      }

