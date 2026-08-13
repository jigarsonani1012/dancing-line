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

