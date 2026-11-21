/* oxlint-disable -- Vendored Bloub engine; preserve upstream implementation. */
// Vendored pure engine from @norbert_bodziony/bloub 0.6.3 (MIT). See ../SOURCE.md.
//#region src/bot/math.ts
var b = Math.PI * 2,
  x = (e, t = 0, n = 1) => (e < t ? t : e > n ? n : e),
  S = (e, t, n) => e + (t - e) * n,
  C = {
    easeOutCubic: (e) => 1 - (1 - e) ** 3,
    easeInOutCubic: (e) => (e < 0.5 ? 4 * e ** 3 : 1 - (-2 * e + 2) ** 3 / 2),
    easeOutQuint: (e) => 1 - (1 - e) ** 5,
  };
function w(e, t, n = 0) {
  let r = (e / t) * b;
  return (
    0.55 * Math.sin(r + n) +
    0.3 * Math.sin(2 * r + n * 1.7 + 1.1) +
    0.15 * Math.sin(3 * r + n * 2.3 + 2.4)
  );
}
function ee(e) {
  let t = e >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let e = Math.imul(t ^ (t >>> 15), 1 | t);
    return (
      (e = (e + Math.imul(e ^ (e >>> 7), 61 | e)) ^ e), ((e ^ (e >>> 14)) >>> 0) / 4294967296
    );
  };
}
var T = (e) => Math.round(e * 100) / 100;
//#endregion
//#region src/bot/decor.ts
function te(e, t = 0.55, n = 0.62) {
  let r = ((e % 360) + 360) % 360,
    i = (1 - Math.abs(2 * n - 1)) * t,
    a = i * (1 - Math.abs(((r / 60) % 2) - 1)),
    o = n - i / 2,
    [s, c, l] =
      r < 60
        ? [i, a, 0]
        : r < 120
          ? [a, i, 0]
          : r < 180
            ? [0, i, a]
            : r < 240
              ? [0, a, i]
              : r < 300
                ? [a, 0, i]
                : [i, 0, a],
    u = (e) =>
      Math.round((e + o) * 255)
        .toString(16)
        .padStart(2, "0");
  return `#${u(s)}${u(c)}${u(l)}`;
}
function ne(e, t, n, r, i = 1) {
  let a = e.phase + t * e.speed * b,
    o = Math.cos(e.tilt),
    s = Math.sin(e.tilt),
    c = Math.sqrt(Math.max(0, 1 - e.k * e.k)),
    l = e.sweep * b,
    u = "",
    d = "",
    f = null;
  for (let t = 0; t <= 64; t++) {
    let r = a + (t / 64) * l,
      i = Math.cos(r),
      p = Math.sin(r),
      m = e.a * (i * o + p * -s * e.k) + e.cx,
      h = e.a * (i * s + p * o * e.k) + e.cy,
      g = e.a * p * c < 0,
      _ = T(m * n),
      v = T(h * n),
      y = g === f ? "L" : "M";
    (g ? (d += `${y}${_} ${v}`) : (u += `${y}${_} ${v}`), (f = g));
  }
  let p = Math.cos(e.tilt) * e.a * n,
    m = Math.sin(e.tilt) * e.a * n;
  return {
    id: r,
    front: u,
    back: d,
    width: e.width * n,
    opacity: i,
    grad: {
      x1: T(e.cx * n - p),
      y1: T(e.cy * n - m),
      x2: T(e.cx * n + p),
      y2: T(e.cy * n + m),
      stops: [te(e.hue), te(e.hue + e.hueSpan * 0.5), te(e.hue + e.hueSpan)],
    },
  };
}
var E = ee(659918),
  re = Array.from({ length: 6 }, (e, t) => ({
    a: 1.3 + E() * 0.1,
    k: 0.05 + E() * 0.4,
    tilt: (t / 6) * Math.PI + E() * 0.5,
    speed: 3 + E() * 0.7,
    phase: E() * b,
    sweep: 0.6 + E() * 0.25,
    hue: (t * 360) / 6 + E() * 30,
    hueSpan: 60 + E() * 60,
    width: 0.05 + E() * 0.012,
    cx: 0,
    cy: 0.1,
  })),
  D = Array.from({ length: 4 }, (e, t) => ({
    a: 0.78 + t * 0.2,
    k: 0.05 + t * 0.02,
    tilt: -0.62 + t * 0.05,
    speed: 0.3,
    phase: 0.06 * t,
    sweep: 0.4,
    hue: 95 + t * 62,
    hueSpan: 100,
    width: 0.05,
    cx: 0,
    cy: -0.12,
  })),
  O = [-0.557, -0.013, 0.532],
  k = 0.165,
  ie = 1.25,
  ae = ee(48879),
  oe = Array.from({ length: 5 }, (e, t) => ({
    birth: t * 0.2,
    angle: ae() * b,
    rho: 0.58 + ae() * 0.18,
  }));
function se(e, t) {
  let n = [];
  for (let r of oe) {
    let i = e - r.birth;
    if (i < 0 || i > 0.62) continue;
    let a = r.rho * 0.75 ** (i * 10),
      o = r.angle + (i * 100 * Math.PI) / 180;
    n.push({
      x: Math.cos(o) * a * t,
      y: Math.sin(o) * a * t,
      r: (0.04 + 0.028 * x(i / 0.55)) * t,
      depth: x(1 - a / 0.8),
      opacity: x(i / 0.06) * x((0.62 - i) / 0.08),
    });
  }
  return n;
}
var ce = ee(49383),
  le = Array.from({ length: 4 }, (e, t) => {
    let n = t - 1.5;
    return {
      a: 0.85 * (1 + n * 0.03),
      k: (0.15 / 0.85) * (1 + n * 0.16),
      tilt: (34 * Math.PI) / 180 + n * 0.035,
      speed: 210 / 360,
      phase: -t * 0.045 + ce() * 0.012,
      sweep: 0.34,
      hue: t * 85 + ce() * 20,
      hueSpan: 80,
      width: 0.095,
      cx: 0,
      cy: 0,
    };
  }),
  ue = 0.129,
  de = "#2496e8",
  A = 1.003,
  fe = 0.15,
  j = 1.14,
  pe = 0.054,
  me = 15.46,
  M = 0.186,
  he = 0.412,
  N = {
    yaw: 28.49,
    pitch: 28.62,
    roll: -13,
  },
  P = (e) => (e * Math.PI) / 180;
function ge(e, t, n) {
  let r = Math.cos(n),
    i = Math.sin(n);
  return [
    [e[0] * r + t[0] * i, e[1] * r + t[1] * i, e[2] * r + t[2] * i],
    [t[0] * r - e[0] * i, t[1] * r - e[1] * i, t[2] * r - e[2] * i],
  ];
}
function F(e, t, n = me) {
  let r = [0, 0, 1],
    i = [1, 0, 0],
    a = [0, 1, 0];
  (([r, i] = ge(r, i, P(e.yaw))), ([a, r] = ge(a, r, P(e.pitch))), ([i, a] = ge(i, a, P(e.roll))));
  let o = (e) => {
    let [o, s] = ge(r, i, P(n * e));
    return {
      x: o[0] * t,
      y: o[1] * t,
      a: s[0],
      b: s[1],
      c: a[0],
      d: a[1],
      depth: o[2],
    };
  };
  return [o(-1), o(1)];
}
var _e = ee(24301),
  I = (() => {
    let e = [],
      t = 1.4;
    for (; t < 900;) (e.push(t), (t += 1.9 + _e() * 2.7), _e() < 0.18 && (e.push(t), (t += 0.24)));
    return e;
  })(),
  ve = 0.18;
function ye(e) {
  for (let t = 0; t < I.length; t++) {
    let n = I[t];
    if (e < n) break;
    let r = (e - n) / ve;
    if (r >= 0 && r <= 1) return r < 0.45 ? 1 - r / 0.45 : (r - 0.45) / 0.55;
  }
  return 1;
}
function be(e, t = {}) {
  let { wander: n = 1, blink: r = !0, float: i = !0 } = t;
  return {
    dYaw: (w(e, 11.3, 0.4) * 5.5 + w(e, 3.7, 2.1) * 1.6) * n,
    dPitch: (w(e, 9.1, 1.3) * 4.2 + w(e, 4.3, 0.7) * 1.3) * n,
    dRoll: w(e, 13.7, 3.2) * 2.2 * n,
    lid: r ? ye(e) : 1,
    driftX: i ? w(e, 7.9, 1.9) * 0.006 : 0,
    driftY: i ? w(e, 5.3, 0.3) * 0.007 : 0,
    breath: i ? 1 + Math.sin((e / 3.4) * Math.PI * 2) * 0.005 : 1,
  };
}
function xe(e) {
  return 0.06 + 0.94 * x(e);
}
//#endregion
//#region src/bot/expressions.ts
var L = (e, t, n = 0, r = 1) => ({
    w: e,
    h: t,
    tilt: n,
    open: r,
  }),
  R = (e, t, n = 0, r = 1) => [L(e, t, n, r), L(e, t, -n, r)],
  z = [
    {
      id: "neutre",
      gaze: { ...N },
      split: me,
      eyes: [L(M, he), L(M, he)],
    },
    {
      id: "attentif",
      gaze: {
        yaw: 4,
        pitch: 5,
        roll: -4,
      },
      split: 16,
      eyes: R(0.21, 0.44),
    },
    {
      id: "surpris",
      gaze: {
        yaw: 3,
        pitch: -3,
        roll: 0,
      },
      split: 19,
      eyes: R(0.45, 0.47),
    },
    {
      id: "excite",
      gaze: {
        yaw: 6,
        pitch: -14,
        roll: 0,
      },
      split: 19.5,
      eyes: R(0.4, 0.56, -10),
    },
    {
      id: "heureux",
      gaze: {
        yaw: 5,
        pitch: 9,
        roll: 0,
      },
      split: 17,
      eyes: R(0.27, 0.17, 14),
    },
    {
      id: "hilare",
      gaze: {
        yaw: 4,
        pitch: 14,
        roll: 0,
      },
      split: 18,
      eyes: R(0.34, 0.13, 20),
    },
    {
      id: "colere",
      gaze: {
        yaw: 3,
        pitch: 7,
        roll: 0,
      },
      split: 17,
      eyes: R(0.34, 0.15, 30),
    },
    {
      id: "triste",
      gaze: {
        yaw: 3,
        pitch: -13,
        roll: 0,
      },
      split: 16,
      eyes: R(0.22, 0.4, -28),
    },
    {
      id: "effraye",
      gaze: {
        yaw: 2,
        pitch: -20,
        roll: 0,
      },
      split: 20.5,
      eyes: R(0.4, 0.6),
    },
    {
      id: "mefiant",
      gaze: {
        yaw: 12,
        pitch: 6,
        roll: -6,
      },
      split: 16,
      eyes: [L(0.21, 0.4), L(0.22, 0.15)],
    },
    {
      id: "confus",
      gaze: {
        yaw: -14,
        pitch: 3,
        roll: 8,
      },
      split: 16.5,
      eyes: [L(0.2, 0.44, -18), L(0.28, 0.17, 14)],
    },
    {
      id: "curieux",
      gaze: {
        yaw: 16,
        pitch: -9,
        roll: -15,
      },
      split: 16.5,
      eyes: [L(0.24, 0.46, -8), L(0.2, 0.38, -8)],
    },
    {
      id: "fier",
      gaze: {
        yaw: 5,
        pitch: 17,
        roll: 0,
      },
      split: 17,
      eyes: R(0.3, 0.15, 18),
    },
    {
      id: "timide",
      gaze: {
        yaw: -19,
        pitch: -14,
        roll: -7,
      },
      split: 14,
      eyes: R(0.17, 0.3),
    },
    {
      id: "blase",
      gaze: {
        yaw: -22,
        pitch: 2,
        roll: 0,
      },
      split: 16,
      eyes: R(0.3, 0.12),
    },
    {
      id: "somnolent",
      gaze: {
        yaw: 6,
        pitch: -9,
        roll: -3,
      },
      split: 16,
      eyes: R(0.2, 0.42, 0, 0.42),
    },
  ],
  Se = new Map(z.map((e) => [e.id, e])),
  Ce = "neutre",
  B = (e, t, n) => ({
    w: S(e.w, t.w, n),
    h: S(e.h, t.h, n),
    tilt: S(e.tilt ?? 0, t.tilt ?? 0, n),
    open: S(e.open, t.open, n),
  });
function we(e, t, n) {
  return {
    id: t.id,
    gaze: {
      yaw: S(e.gaze.yaw, t.gaze.yaw, n),
      pitch: S(e.gaze.pitch, t.gaze.pitch, n),
      roll: S(e.gaze.roll, t.gaze.roll, n),
    },
    split: S(e.split, t.split, n),
    eyes: [B(e.eyes[0], t.eyes[0], n), B(e.eyes[1], t.eyes[1], n)],
  };
}
//#endregion
//#region src/bot/profiles.ts
var Te = {
    egg: [
      0.8369, 0.8424, 0.8497, 0.8585, 0.8674, 0.8775, 0.8878, 0.8983, 0.9089, 0.9185, 0.9288,
      0.9374, 0.9445, 0.9504, 0.9543, 0.9559, 0.9555, 0.9519, 0.9466, 0.9389, 0.9302, 0.9193,
      0.9085, 0.8969, 0.8852, 0.8734, 0.8625, 0.8513, 0.8411, 0.8325, 0.8243, 0.8179, 0.8137,
      0.8112, 0.8102, 0.8128, 0.8178, 0.8262, 0.8374, 0.8518, 0.8702, 0.8922, 0.9169, 0.9446,
      0.9741, 1.0023, 1.0267, 1.0433, 1.0481, 1.0393, 1.0216, 0.997, 0.9697, 0.9418, 0.9169, 0.8949,
      0.876, 0.8604, 0.849, 0.8394, 0.8337, 0.8314, 0.8305, 0.8326,
    ],
    hexagon: [
      0.921, 0.9282, 0.9441, 0.9706, 0.9984, 1.0059, 0.9896, 0.9562, 0.929, 0.9124, 0.9047, 0.9058,
      0.9157, 0.9349, 0.9642, 0.9873, 0.9882, 0.9665, 0.9336, 0.9105, 0.8968, 0.8918, 0.8955, 0.908,
      0.9293, 0.9611, 0.982, 0.9812, 0.959, 0.9282, 0.9089, 0.8978, 0.8964, 0.9026, 0.9189, 0.9439,
      0.9778, 0.999, 0.9964, 0.9713, 0.9439, 0.9274, 0.9196, 0.9206, 0.9308, 0.9502, 0.9799, 1.0121,
      1.0226, 1.0071, 0.9752, 0.951, 0.9366, 0.9316, 0.9351, 0.9485, 0.9711, 1.0026, 1.0213, 1.0155,
      0.9863, 0.9547, 0.9347, 0.9232,
    ],
    triangle: [
      0.7819, 0.8211, 0.8747, 0.944, 1.0223, 1.096, 1.1401, 1.134, 1.0808, 1.0047, 0.9265, 0.8603,
      0.8104, 0.773, 0.745, 0.7273, 0.7151, 0.7118, 0.7148, 0.7245, 0.7427, 0.768, 0.8037, 0.8518,
      0.9148, 0.9876, 1.0583, 1.1073, 1.1109, 1.0667, 0.994, 0.9164, 0.8482, 0.7948, 0.7555, 0.7261,
      0.7056, 0.6925, 0.6859, 0.6869, 0.6938, 0.7084, 0.7305, 0.7615, 0.804, 0.8595, 0.9311, 1.0092,
      1.0791, 1.1171, 1.1054, 1.0501, 0.9779, 0.905, 0.845, 0.799, 0.7656, 0.7413, 0.7258, 0.716,
      0.7146, 0.7204, 0.733, 0.7528,
    ],
  },
  Ee = Array.from({ length: 64 }, (e, t) => (t / 64) * b),
  V = Ee.map(Math.cos),
  H = Ee.map(Math.sin);
function De(e, t = {}) {
  return {
    radii: [...Te[e]],
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...t,
  };
}
function U(e, t = {}) {
  return {
    radii: Array(64).fill(e),
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...t,
  };
}
function Oe(e, t, n, r) {
  let i = r ?? {
    radii: Array(64),
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
  };
  for (let r = 0; r < 64; r++) i.radii[r] = S(e.radii[r] ?? 1, t.radii[r] ?? 1, n);
  let a = t.rot - e.rot;
  for (; a > Math.PI;) a -= b;
  for (; a < -Math.PI;) a += b;
  return (
    (i.rot = e.rot + a * n),
    (i.cx = S(e.cx, t.cx, n)),
    (i.cy = S(e.cy, t.cy, n)),
    (i.sx = S(e.sx, t.sx, n)),
    (i.sy = S(e.sy, t.sy, n)),
    i
  );
}
function W(e, t, n = []) {
  let r = Math.cos(e.rot),
    i = Math.sin(e.rot);
  for (let a = 0; a < 64; a++) {
    let o = e.radii[a] ?? 1,
      s = o * (V[a] ?? 0),
      c = o * (H[a] ?? 0),
      l = s * r - c * i,
      u = s * i + c * r,
      d = n[a] ?? {
        x: 0,
        y: 0,
      };
    ((d.x = (l * e.sx + e.cx) * t), (d.y = (u * e.sy + e.cy) * t), (n[a] = d));
  }
  return ((n.length = 64), n);
}
function ke(e, t = 1 / 6) {
  let n = e.length;
  if (n < 3) return "";
  let r = e[0],
    i = `M${T(r.x)} ${T(r.y)}`;
  for (let r = 0; r < n; r++) {
    let a = e[(r - 1 + n) % n],
      o = e[r],
      s = e[(r + 1) % n],
      c = e[(r + 2) % n],
      l = o.x + (s.x - a.x) * t,
      u = o.y + (s.y - a.y) * t,
      d = s.x - (c.x - o.x) * t,
      f = s.y - (c.y - o.y) * t;
    i += `C${T(l)} ${T(u)} ${T(d)} ${T(f)} ${T(s.x)} ${T(s.y)}`;
  }
  return `${i}Z`;
}
function G(e, t, n) {
  let r = Array(64).fill(0),
    i = e.length;
  for (let a = 0; a < 64; a++) {
    let o = V[a] ?? 0,
      s = H[a] ?? 0,
      c = 0;
    for (let r = 0; r < i; r++) {
      let a = e[r],
        l = e[(r + 1) % i],
        u = l.x - a.x,
        d = l.y - a.y,
        f = o * d - s * u;
      if (Math.abs(f) < 1e-9) continue;
      let p = a.x - t,
        m = a.y - n,
        h = (p * d - m * u) / f,
        g = (p * s - m * o) / f;
      h > c && g >= 0 && g <= 1 && (c = h);
    }
    r[a] = c;
  }
  return r;
}
function K(e, t, n, r, i, a, o = 96) {
  let s = r - e,
    c = i - t,
    l = Math.hypot(s, c) || 1e-6,
    u = Math.atan2(c, s),
    d = Math.acos(Math.max(-1, Math.min(1, (n - a) / l))),
    f = [];
  for (let r = 0; r <= o / 2; r++) {
    let i = u + d + ((b - 2 * d) * r) / (o / 2);
    f.push({
      x: e + Math.cos(i) * n,
      y: t + Math.sin(i) * n,
    });
  }
  for (let e = 0; e <= o / 2; e++) {
    let t = u - d + (2 * d * e) / (o / 2);
    f.push({
      x: r + Math.cos(t) * a,
      y: i + Math.sin(t) * a,
    });
  }
  return f;
}
function Ae(e, t) {
  let n = e.length,
    r = ((((t / b) % 1) + 1) % 1) * n,
    i = Math.floor(r);
  return S(e[i % n] ?? 1, e[(i + 1) % n] ?? 1, r - i);
}
function je(e, t = 1, n = 1) {
  return Ee.map(
    (r, i) => (Math.abs((V[i] ?? 0) / t) ** e + Math.abs((H[i] ?? 0) / n) ** e) ** (-1 / e),
  );
}
function Me(e) {
  let t = Array(64).fill(0);
  for (let n = 0; n < 64; n++) {
    let r = V[n] ?? 0,
      i = H[n] ?? 0,
      a = 0;
    for (let t of e) {
      let e = r * t.x + i * t.y,
        n = e * e - (t.x * t.x + t.y * t.y - t.r * t.r);
      if (n < 0) continue;
      let o = e + Math.sqrt(n);
      o > a && (a = o);
    }
    t[n] = a;
  }
  return t;
}
function Ne(e, t, n = 10) {
  let r = e.length,
    i = [],
    a = (e, t) => {
      let n = t.x - e.x,
        r = t.y - e.y,
        i = Math.hypot(n, r) || 1;
      return Math.atan2(-n / i, r / i);
    };
  for (let o = 0; o < r; o++) {
    let s = e[(o - 1 + r) % r],
      c = e[o],
      l = e[(o + 1) % r],
      u = a(s, c),
      d = a(c, l) - u;
    for (; d > Math.PI;) d -= b;
    for (; d < -Math.PI;) d += b;
    for (let e = 0; e <= n; e++) {
      let r = u + (d * e) / n;
      i.push({
        x: c.x + Math.cos(r) * t,
        y: c.y + Math.sin(r) * t,
      });
    }
  }
  return i;
}
function q(e, t, n, r = 0) {
  let i = (r * Math.PI) / 180;
  return G(
    Ne(
      Array.from({ length: e }, (r, a) => {
        let o = i + (a / e) * b;
        return {
          x: Math.cos(o) * (t - n),
          y: Math.sin(o) * (t - n),
        };
      }),
      n,
    ),
    0,
    0,
  );
}
function Pe(e, t = 1) {
  if (e.length < 3) return "";
  let n = "";
  for (let r = 0; r < e.length; r++) {
    let i = e[r];
    n += `${r === 0 ? "M" : "L"}${T(i.x * t)} ${T(i.y * t)}`;
  }
  return `${n}Z`;
}
function Fe(e, t) {
  let n = Math.max(e, 0.01) / 2,
    r = Math.max(t, 0.01) / 2,
    i = Math.min(n, r);
  return `M${T(-n)} ${T(-r + i)}A${T(i)} ${T(i)} 0 0 1 ${T(-n + i)} ${T(-r)}L${T(n - i)} ${T(-r)}A${T(i)} ${T(i)} 0 0 1 ${T(n)} ${T(-r + i)}L${T(n)} ${T(r - i)}A${T(i)} ${T(i)} 0 0 1 ${T(n - i)} ${T(r)}L${T(-n + i)} ${T(r)}A${T(i)} ${T(i)} 0 0 1 ${T(-n)} ${T(r - i)}Z`;
}
//#endregion
//#region src/bot/skins.ts
function Ie(e, t = 1) {
  let n = Math.max(...e);
  if (n <= 0) return e;
  let r = t / n;
  return e.map((e) => e * r);
}
var Le = Ie(
    Array.from({ length: 64 }, (e, t) => (t / 64) * Math.PI * 2).map(
      (e) => 1 + 0.075 * Math.cos(2 * e + 0.5) + 0.035 * Math.cos(3 * e + 2.1),
    ),
    1.02,
  ),
  Re = Ie(
    Me([
      {
        x: -0.44,
        y: 0.2,
        r: 0.54,
      },
      {
        x: 0.46,
        y: 0.2,
        r: 0.5,
      },
      {
        x: 0.02,
        y: 0.3,
        r: 0.6,
      },
      {
        x: -0.24,
        y: -0.3,
        r: 0.48,
      },
      {
        x: 0.3,
        y: -0.24,
        r: 0.44,
      },
    ]),
    1.02,
  ),
  ze = Ie(G(K(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0), 1.04),
  Be = G(K(-0.42, 0, 0.62, 0.42, 0, 0.62), 0, 0),
  Ve = [
    {
      id: "cercle",
      radii: Array(64).fill(1),
    },
    {
      id: "galet",
      radii: Le,
    },
    {
      id: "squircle",
      radii: Ie(je(4.2), 1.15),
    },
    {
      id: "capsule",
      radii: Be,
    },
    {
      id: "triangle",
      radii: q(3, 1.12, 0.34, -90),
    },
    {
      id: "hexagone",
      radii: q(6, 1.04, 0.26, 0),
    },
    {
      id: "nuage",
      radii: Re,
    },
    {
      id: "goutte",
      radii: ze,
    },
    {
      id: "carre",
      radii: q(4, 1.2, 0.24, 45),
    },
    {
      id: "losange",
      radii: q(4, 1.14, 0.3, -90),
    },
    {
      id: "pentagone",
      radii: q(5, 1.08, 0.28, -90),
    },
  ],
  He = new Map(Ve.map((e) => [e.id, e])),
  Ue = "cercle",
  We = [
    {
      id: "encre",
      hex: "#0a0a0c",
    },
    {
      id: "brun",
      hex: "#8b5e3c",
    },
    {
      id: "rouge",
      hex: "#e8483f",
    },
    {
      id: "orange",
      hex: "#f08a24",
    },
    {
      id: "ambre",
      hex: "#f0b429",
    },
    {
      id: "vert",
      hex: "#3ecf8e",
    },
    {
      id: "turquoise",
      hex: "#2fbfa0",
    },
    {
      id: "bleu",
      hex: "#3b93f0",
    },
    {
      id: "violet",
      hex: "#8b5cf6",
    },
    {
      id: "rose",
      hex: "#e152b0",
    },
    {
      id: "gris",
      hex: "#a3a3a3",
    },
    {
      id: "creme",
      hex: "#f1efe9",
    },
  ],
  Ge = new Map(We.map((e) => [e.id, e])),
  Ke = "encre";
function qe(e, t, n) {
  let r = (e) => {
      let t = parseInt(e.slice(1), 16);
      return [(t >> 16) & 255, (t >> 8) & 255, t & 255];
    },
    i = r(e),
    a = r(t);
  return `#${i
    .map((e, t) => Math.round(e + (a[t] - e) * n))
    .map((e) => e.toString(16).padStart(2, "0"))
    .join("")}`;
}
//#endregion
//#region src/bot/states.ts
var J = (e, t) => [
  {
    w: e,
    h: t,
    open: 1,
  },
  {
    w: e,
    h: t,
    open: 1,
  },
];
function Y(e = {}) {
  return {
    sil: U(1),
    offX: 0,
    offY: 0,
    gaze: { ...N },
    split: me,
    eyes: J(M, he),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: !1,
    ...e,
  };
}
var Je = -0.1875,
  X = G(K(0, -0.505, 0.132, 0, 0.13, 0.075), 0, Je),
  Ye = G(K(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0),
  Xe = (e = {}) => ({
    radii: [...X],
    rot: 0,
    cx: 0,
    cy: Je,
    sx: 1,
    sy: 1,
    ...e,
  }),
  Ze = (e = {}) => ({
    radii: [...Ye],
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...e,
  }),
  Qe = Pe(K(0, 0, 0.118, 0, 0.172, 0.012)),
  $e = 0.213;
function et(e) {
  return De("triangle", {
    rot: e,
    cx: -0.213 * Math.sin(e),
    cy: $e * Math.cos(e),
  });
}
function tt(e, t) {
  let n = ((((e - t * 0.5) / 1.5) % 1) + 1) % 1;
  return x((n < 0.5 ? 0.5 - 0.5 * Math.cos(n * b) : 0) * 2);
}
var nt = [
    {
      id: "idle",
      duration: 2.4,
      morph: 0.45,
      blinkIn: !1,
      baseFace: !0,
      baseBody: !0,
      pose: () => Y(),
    },
    {
      id: "thinking",
      duration: 2.6,
      morph: 0.4,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !0,
      pose: (e) => {
        let t = tt(e, 1),
          n = 0.3 + 0.7 * C.easeOutCubic(x(e / 0.3));
        return Y({
          sil: U(k * (1 + (ie - 1) * t), { cx: O[1] }),
          eyeAlpha: 0,
          dots: [0, 2].map((t) => {
            let r = tt(e, t);
            return {
              x: O[t] * n,
              y: 0,
              r: k * (1 + (ie - 1) * r),
              opacity: 0.55 + 0.45 * r,
            };
          }),
        });
      },
    },
    {
      id: "wink",
      duration: 1.6,
      morph: 0.3,
      blinkIn: !0,
      baseFace: !1,
      baseBody: !0,
      pose: () =>
        Y({
          gaze: {
            yaw: -5.37,
            pitch: 4.55,
            roll: 6.7,
          },
          split: 16.25,
          eyes: [
            {
              w: 0.236,
              h: 0.464,
              open: 1,
            },
            {
              w: 0.447,
              h: 0.089,
              open: 1,
            },
          ],
        }),
    },
    {
      id: "wide",
      duration: 1.8,
      morph: 0.55,
      blinkIn: !0,
      baseFace: !1,
      baseBody: !0,
      pose: () =>
        Y({
          gaze: {
            yaw: 6.92,
            pitch: -21.96,
            roll: 11.6,
          },
          split: 18.43,
          eyes: J(0.356, 0.875),
        }),
    },
    {
      id: "alert",
      duration: 2.4,
      minDuration: 2,
      morph: 0.45,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: (e) => {
        let t = x(e / 1.5),
          n = C.easeInOutCubic(t) * 0.82 - 0.087,
          r = e > 1.6 ? x((e - 1.6) / 0.4) : 0,
          i = n * (1 - r) + 0.1 * r,
          a = Math.sin(e * 2.5 * b) * 0.005,
          o = (17.7 * Math.PI) / 180;
        return Y({
          sil: Ze({
            rot: o,
            cx: i,
            cy: -0.325 - a,
          }),
          eyeAlpha: 0,
          dots: [
            {
              x: i - Math.sin(o) * 0.58,
              y: -0.325 + Math.cos(o) * 0.58 + a * 2.8,
              r: 0.118,
              d: Qe,
              rot: (o * 180) / Math.PI,
              opacity: 1,
            },
          ],
        });
      },
    },
    {
      id: "notify",
      duration: 2.2,
      morph: 0.5,
      blinkIn: !0,
      baseFace: !1,
      baseBody: !0,
      pose: (e) => {
        let t = x(e / 0.45),
          n = 1 + (j - 1) * Math.sin(t * Math.PI) * (1 - t * 0.35),
          r = fe * (t < 1 ? n : 1),
          i = (-42 * Math.PI) / 180;
        return Y({
          gaze: {
            yaw: -21.94,
            pitch: -5.82,
            roll: -12.2,
          },
          split: 18.89,
          eyes: J(0.505, 0.498),
          notif: {
            x: Math.cos(i) * A,
            y: Math.sin(i) * A,
            r,
            notch: r + pe,
          },
        });
      },
    },
    {
      id: "exclaim",
      duration: 2,
      morph: 0.45,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: () =>
        Y({
          sil: Xe(),
          eyeAlpha: 0,
          dots: [
            {
              x: -0.012,
              y: 0.526,
              r: 0.113,
              opacity: 1,
            },
          ],
        }),
    },
    {
      id: "sleep",
      duration: 2.4,
      morph: 0.5,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: (e) =>
        Y({
          sil: U(0.1585, { cy: 0.11 + Math.sin((b / 0.6) * e) * 0.19 }),
          eyeAlpha: 0,
        }),
    },
    {
      id: "egg",
      duration: 1.8,
      morph: 0.4,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !0,
      pose: () =>
        Y({
          sil: De("egg"),
          gaze: {
            yaw: 19.97,
            pitch: 26.01,
            roll: -17.1,
          },
          split: 11.07,
          eyes: J(0.164, 0.385),
        }),
    },
    {
      id: "hexagon",
      duration: 1.6,
      morph: 0.4,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !0,
      pose: () =>
        Y({
          sil: De("hexagon"),
          gaze: {
            yaw: 23.11,
            pitch: 24.42,
            roll: -13.3,
          },
          split: 13.37,
          eyes: J(0.177, 0.411),
        }),
    },
    {
      id: "play",
      duration: 2,
      morph: 0.5,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !0,
      pose: (e) => {
        let t = x(e / 0.35) * x((2.2 - e) / 0.5);
        return Y({
          sil: et(0),
          gaze: {
            yaw: 12,
            pitch: -8,
            roll: -6,
          },
          split: 15,
          eyes: J(0.18, 0.34),
          arcs: D.map((n, r) => ({
            id: `sw${r}`,
            seed: {
              ...n,
              cx: 0.45 - e * 0.42,
            },
            t: e,
            opacity: t,
          })),
        });
      },
    },
    {
      id: "orbit",
      duration: 3.4,
      minDuration: 2.5,
      morph: 0.6,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: (e) => {
        let t = C.easeInOutCubic(x(e / 0.35)),
          n = -b * 1.25 * e * t,
          r = C.easeInOutCubic(x((e - 1.6) / 0.9)),
          i = et(n),
          a = U(1, { rot: n }),
          o = {
            radii: i.radii.map((e, t) => e + (a.radii[t] - e) * r),
            rot: n,
            cx: i.cx * (1 - r),
            cy: i.cy * (1 - r),
            sx: 1,
            sy: 1,
          },
          s = x(e / 0.8) * x((3.6 - e) / 0.9);
        return Y({
          sil: o,
          gaze: {
            yaw: N.yaw + Math.sin(e * 6.5) * 65 * (1 - r),
            pitch: -4 + r * 32,
            roll: -13,
          },
          eyes: J(0.18, 0.34 + r * 0.07),
          arcs: re.map((t, n) => ({
            id: `rg${n}`,
            seed: t,
            t: e,
            opacity: s * x((e - n * 0.13) / 0.3),
          })),
        });
      },
    },
    {
      id: "swirl",
      duration: 1.3,
      minDuration: 1.3,
      morph: 0.3,
      baseFace: !0,
      baseBody: !0,
      blinkIn: !0,
      pose: (e) =>
        Y({
          arcs: re.slice(0, 3).map((t, n) => ({
            id: `sw${n}`,
            seed: t,
            t: e,
            opacity: x((e - n * 0.06) / 0.14) * x((1.22 - e) / 0.34),
          })),
        }),
    },
    {
      id: "burst",
      duration: 2.6,
      minDuration: 2.4,
      morph: 0.4,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: (e) => {
        let t = 1 - 0.834 * C.easeOutQuint(x(e / 0.7)),
          n = C.easeOutQuint(x((e - 1.7) / 0.7));
        return Y({
          sil: U(t + (1 - t) * n),
          eyeAlpha: x((e - 1.85) / 0.4),
          dots: se(e, 1),
          dotsBehind: !0,
        });
      },
    },
    {
      id: "comet",
      duration: 2.4,
      minDuration: 2.4,
      morph: 0.45,
      baseFace: !1,
      baseBody: !1,
      blinkIn: !1,
      pose: (e) => {
        let t = 1 - (1 - ue) * C.easeOutQuint(x(e / 0.55)),
          n = C.easeOutQuint(x((e - 1.85) / 0.6)),
          r = x((e - 0.15) / 0.25) * x((1.95 - e) / 0.3);
        return Y({
          sil: U(t + (1 - t) * n, { cy: Math.sin(x(e / 1.7) * Math.PI) * 0.035 }),
          eyeAlpha: x((e - 2) / 0.35),
          arcs: le.map((t, n) => ({
            id: `cm${n}`,
            seed: t,
            t: e,
            opacity: r,
          })),
        });
      },
    },
  ],
  Z = new Map(nt.map((e) => [e.id, e])),
  rt = {
    idle: 1,
    thinking: 1.1,
    wink: 0.8,
    wide: 0.8,
    alert: 0.75,
    notify: 0.9,
    exclaim: 0.8,
    sleep: 0.45,
    egg: 0.8,
    hexagon: 0.8,
    play: 0.9,
    orbit: 1.2,
    swirl: 0.5,
    burst: 0.45,
    comet: 1.15,
  },
  it = [
    "idle",
    "thinking",
    "wink",
    "wide",
    "alert",
    "notify",
    "exclaim",
    "sleep",
    "egg",
    "hexagon",
    "play",
    "orbit",
    "burst",
    "comet",
  ],
  Q = 100,
  at = 7.1,
  ot = 5.5,
  st = 0.006,
  ct = 0.007;
function lt(e, t, n) {
  let r = [],
    i = F(e.gaze, Q, e.split);
  for (let a = 0; a < 2; a++) {
    let o = i[a];
    if (o.depth <= 0.02) continue;
    let s = e.eyes[a],
      c = ((s.tilt ?? 0) * Math.PI) / 180,
      l = Math.cos(c),
      u = Math.sin(c),
      d = o.a * l + o.c * u,
      f = o.b * l + o.d * u,
      p = -o.a * u + o.c * l,
      m = -o.b * u + o.d * l,
      h = Math.max(s.w * Q, 0.01) / 2,
      g = Math.max(s.h * Q, 0.01) / 2,
      _ = Math.min(h, g),
      v = g > h,
      y = v ? g - _ : h - _,
      b = Ae(n, Math.atan2(o.y, o.x) - t.rot);
    r.push({
      x: o.x * b,
      y: o.y * b,
      ax: (v ? p : d) * y,
      ay: (v ? m : f) * y,
      r: _,
      m: [d, f, p, m],
    });
  }
  return r;
}
function ut(e, t, n, r, i) {
  let a = r - t,
    o = i - n,
    s = a * a + o * o,
    c = Infinity,
    l = 0,
    u = 0;
  for (let r = 0; r < e.length; r++) {
    let i = e[r],
      d = s > 0 ? ((i.x - t) * a + (i.y - n) * o) / s : 0;
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    let f = t + d * a - i.x,
      p = n + d * o - i.y,
      m = f * f + p * p;
    m < c && ((c = m), (l = f), (u = p));
  }
  let d = Math.sqrt(c);
  return {
    d,
    ux: d > 1e-9 ? l / d : 0,
    uy: d > 1e-9 ? u / d : 0,
  };
}
var dt = Math.hypot(st, ct) * Q;
function ft(e, t, n, r) {
  let i = Infinity,
    a = 0,
    o = 0;
  for (let s of t) {
    let t = s.x + n,
      c = s.y + r,
      l = ut(e, t - s.ax, c - s.ay, t + s.ax, c + s.ay),
      [u, d, f, p] = s.m,
      m = s.r * Math.hypot(u * l.ux + d * l.uy, f * l.ux + p * l.uy) + dt;
    l.d - m < i && ((i = l.d - m), (a = l.ux), (o = l.uy));
  }
  return {
    marge: i,
    ux: a,
    uy: o,
  };
}
var pt = 12,
  mt = 8;
function ht(e) {
  if (!e.length)
    return {
      x: 0,
      y: 0,
    };
  let t = (t, n) => {
      let r = Infinity;
      for (let i of e) r = Math.min(r, ft(i.contour, i.empreintes, t, n).marge);
      return r;
    },
    n = Infinity;
  for (let t of e) n = Math.min(n, ft(t.calContour, t.reference, 0, 0).marge);
  let r = 0,
    i = 0,
    a = e[0].empreintes;
  for (let e of a) ((r -= e.x / a.length), (i -= e.y / a.length));
  let o = Math.max(0.35 * Q, Math.hypot(r, i) * 1.25);
  n = Math.min(n, t(r, i));
  let s = t(0, 0);
  if (s >= n && s >= 0)
    return {
      x: 0,
      y: 0,
    };
  let c = Math.max(n, 0),
    l = 0,
    u = 0,
    d = Infinity,
    f = 0,
    p = 0,
    m = s;
  for (let e = 0; e < pt; e++) {
    let n = (e / pt) * Math.PI * 2,
      r = Math.cos(n),
      i = Math.sin(n);
    if (t(r * o, i * o) < c) {
      for (let e of [0.3, 0.6, 1]) {
        let n = t(r * o * e, i * o * e);
        n > m && ((m = n), (f = r * o * e), (p = i * o * e));
      }
      continue;
    }
    let a = 0,
      s = o;
    for (let e = 0; e < mt; e++) {
      let e = (a + s) / 2;
      t(r * e, i * e) >= c ? (s = e) : (a = e);
    }
    s < d && ((d = s), (l = r * s), (u = i * s));
  }
  let h = d === Infinity ? f : l,
    g = d === Infinity ? p : u;
  return {
    x: +(h / Q).toFixed(6),
    y: +(g / Q).toFixed(6),
  };
}
function gt(e, t, n) {
  return e.baseFace && n
    ? {
        gaze: n.gaze,
        split: n.split,
        eyes: n.eyes,
      }
    : {
        gaze: t.gaze,
        split: t.split,
        eyes: t.eyes,
      };
}
function _t(e) {
  let t = (e) =>
    JSON.stringify([e.gaze, e.split, e.eyes, e.sil.rot, e.sil.cx, e.sil.cy, e.sil.sx, e.sil.sy]);
  return t(e.pose(0)) === t(e.pose(e.duration))
    ? [0]
    : Array.from({ length: 3 }, (t, n) => (n / 2) * e.duration);
}
function vt(e, t, n) {
  let r = [];
  for (let i of _t(e)) {
    let a = e.pose(i),
      o = W(
        {
          ...a.sil,
          radii: t,
        },
        Q,
      ),
      s = W(a.sil, Q),
      c = gt(e, a, n),
      l = [];
    for (let e of [-7.1, at])
      for (let t of [-5.5, ot])
        l.push({
          ...c,
          gaze: {
            yaw: c.gaze.yaw + e,
            pitch: c.gaze.pitch + t,
            roll: c.gaze.roll,
          },
        });
    for (let e of l)
      r.push({
        empreintes: lt(e, a.sil, t),
        reference: lt(e, a.sil, a.sil.radii),
        contour: o,
        calContour: s,
      });
  }
  return ht(r);
}
var yt = {
    x: 0,
    y: 0,
  },
  bt = (e, t) => `${e}|${t ?? ""}`;
function xt() {
  return new Map(
    Ve.map((e) => {
      let t = /* @__PURE__ */ new Map();
      for (let n of nt) {
        if (!n.baseBody) continue;
        let r = n.baseFace ? [null, ...z] : [null];
        for (let i of r) t.set(bt(n.id, i?.id ?? null), vt(n, e.radii, i));
      }
      return [e.radii, t];
    }),
  );
}
var St = xt();
function Ct(e, t, n) {
  if (!e) return yt;
  let r = St.get(e);
  return r ? (r.get(bt(t, n)) ?? r.get(bt(t, null)) ?? yt) : yt;
}
//#endregion
//#region src/bot/engine.ts
var wt = 0.2,
  Tt = {
    yaw: 0,
    pitch: 0,
    mix: 0,
    spin: 0,
    wander: 1,
  },
  Et = (e, t, n) => ({
    yaw: S(e.yaw, t.yaw, n),
    pitch: S(e.pitch, t.pitch, n),
    mix: S(e.mix, t.mix, n),
    spin: S(e.spin, t.spin, n),
    wander: S(e.wander, t.wander, n),
    ...(e.blink === void 0 && t.blink === void 0
      ? {}
      : { blink: S(e.blink ?? 1, t.blink ?? 1, n) }),
  }),
  Dt = (e, t, n) => ({
    w: S(e.w, t.w, n),
    h: S(e.h, t.h, n),
    open: S(e.open, t.open, n),
    tilt: S(e.tilt ?? 0, t.tilt ?? 0, n),
  });
function Ot(e, t, n) {
  let r = 1 - n;
  return {
    sil: Oe(e.sil, t.sil, n),
    offX: S(e.offX, t.offX, n),
    offY: S(e.offY, t.offY, n),
    gaze: {
      yaw: S(e.gaze.yaw, t.gaze.yaw, n),
      pitch: S(e.gaze.pitch, t.gaze.pitch, n),
      roll: S(e.gaze.roll, t.gaze.roll, n),
    },
    split: S(e.split, t.split, n),
    eyes: [Dt(e.eyes[0], t.eyes[0], n), Dt(e.eyes[1], t.eyes[1], n)],
    eyeAlpha: S(e.eyeAlpha, t.eyeAlpha, n),
    bodyAlpha: S(e.bodyAlpha, t.bodyAlpha, n),
    dots: [
      ...e.dots.map((e) => ({
        ...e,
        opacity: e.opacity * r,
      })),
      ...t.dots.map((e) => ({
        ...e,
        opacity: e.opacity * n,
      })),
    ],
    arcs: [
      ...e.arcs.map((e) => ({
        ...e,
        id: `a${e.id}`,
        opacity: e.opacity * r,
      })),
      ...t.arcs.map((e) => ({
        ...e,
        id: `b${e.id}`,
        opacity: e.opacity * n,
      })),
    ],
    notif: n < 0.5 ? e.notif : t.notif,
    dotsBehind: n < 0.5 ? e.dotsBehind : t.dotsBehind,
  };
}
var kt = class e {
    scale;
    cur;
    prev = null;
    departFige = null;
    decalageFige = null;
    tCur = 0;
    tPrev = 0;
    posePhase = 0;
    previousPosePhase = 0;
    blinkAt = -10;
    pts = [];
    shape = null;
    shapePrev = null;
    shapeAt = -10;
    expr = null;
    exprPrev = null;
    exprAt = -10;
    exprDepart = null;
    look = Tt;
    lookPrev = Tt;
    lookAt = -10;
    lookMorph = 0.24;
    static SHAPE_MORPH = 0.45;
    static LOOK_MORPH = 0.24;
    constructor(e = 100, t = "idle", n = null, r = null) {
      ((this.scale = e), (this.cur = t), (this.shape = n), (this.expr = r));
    }
    setExpression(t, n = 0) {
      if (t === this.expr) return;
      let r = (n - this.exprAt) / e.SHAPE_MORPH;
      if (this.expr && this.exprPrev && r >= 0 && r < 1) {
        let e = C.easeOutQuint(x(r)),
          t = this.exprDepart ?? [
            {
              id: this.exprPrev.id,
              poids: 1,
            },
          ];
        ((this.exprDepart = [
          ...t
            .map(({ id: t, poids: n }) => ({
              id: t,
              poids: n * (1 - e),
            }))
            .filter(({ poids: e }) => e > 1e-9),
          {
            id: this.expr.id,
            poids: e,
          },
        ]),
          (this.exprPrev = we(this.exprPrev, this.expr, e)));
      } else ((this.exprDepart = null), (this.exprPrev = this.expr));
      ((this.expr = t), (this.exprAt = n));
    }
    exprAtTime(t) {
      let n = this.expr,
        r = this.exprPrev;
      if (!n || !r) return n;
      let i = (t - this.exprAt) / e.SHAPE_MORPH;
      return i >= 1 ? n : we(r, n, C.easeOutQuint(x(i)));
    }
    setShape(e, t = 0) {
      e !== this.shape && ((this.shapePrev = this.shape), (this.shape = e), (this.shapeAt = t));
    }
    shapeAtTime(t) {
      let n = this.shape,
        r = this.shapePrev;
      if (!n || !r) return n;
      let i = (t - this.shapeAt) / e.SHAPE_MORPH;
      if (i >= 1) return n;
      let a = C.easeOutQuint(x(i));
      return n.map((e, t) => S(r[t] ?? e, e, a));
    }
    setLook(t, n, r = e.LOOK_MORPH) {
      (t && !Number.isFinite(t.yaw + t.pitch + t.mix + t.spin + t.wander + (t.blink ?? 1))) ||
        ((this.lookPrev = this.lookAtTime(n)),
        (this.look = t ?? Tt),
        (this.lookAt = n),
        (this.lookMorph = r));
    }
    lookAtTime(e) {
      let t = (e - this.lookAt) / this.lookMorph;
      return t >= 1 ? this.look : Et(this.lookPrev, this.look, C.easeOutQuint(x(t)));
    }
    posed(e, t, n, r) {
      let i = e.pose(t);
      return (
        e.baseBody &&
          n &&
          (i = {
            ...i,
            sil: {
              ...i.sil,
              radii: n,
            },
          }),
        e.baseFace &&
          r &&
          (i = {
            ...i,
            gaze: r.gaze,
            split: r.split,
            eyes: r.eyes,
          }),
        i
      );
    }
    decalageAtTime(t, n) {
      let r = (e, n, r, i) => {
          if (r === i) return i;
          let a = (t - e) / n;
          if (a >= 1) return i;
          let o = C.easeOutQuint(x(a));
          return {
            x: S(r.x, i.x, o),
            y: S(r.y, i.y, o),
          };
        },
        i = (e) => {
          if (!this.exprDepart) return Ct(e, n, this.exprPrev?.id ?? null);
          let t = 0,
            r = 0;
          for (let { id: i, poids: a } of this.exprDepart) {
            let o = Ct(e, n, i);
            ((t += o.x * a), (r += o.y * a));
          }
          return {
            x: t,
            y: r,
          };
        },
        a = (a) => {
          let o = Ct(a, n, this.expr?.id ?? null);
          return t - this.exprAt >= e.SHAPE_MORPH ? o : r(this.exprAt, e.SHAPE_MORPH, i(a), o);
        };
      return r(this.shapeAt, e.SHAPE_MORPH, a(this.shapePrev), a(this.shape));
    }
    get state() {
      return this.cur;
    }
    quiet(t) {
      let n = Z.get(this.cur).morph;
      return t - this.tCur < n ||
        t - this.shapeAt < e.SHAPE_MORPH ||
        t - this.exprAt < e.SHAPE_MORPH ||
        t - this.blinkAt < wt
        ? !1
        : this.lookAtTime(t).blink === 0 || be(t).lid >= 1;
    }
    reset(e, t) {
      ((this.cur = e),
        (this.prev = null),
        (this.departFige = null),
        (this.decalageFige = null),
        (this.tCur = t),
        (this.tPrev = t),
        (this.posePhase = 0),
        (this.previousPosePhase = 0),
        (this.blinkAt = -10));
    }
    origine(e, t, n) {
      if (this.departFige) return this.departFige;
      if (!this.prev) return null;
      let r = Z.get(this.prev);
      return this.posed(r, Math.max(0, e - this.tPrev + this.previousPosePhase), t, n);
    }
    poseComposee(e) {
      let t = Z.get(this.cur),
        n = this.shapeAtTime(e),
        r = this.exprAtTime(e),
        i = this.posed(t, Math.max(0, e - this.tCur + this.posePhase), n, r),
        a = e - this.tCur;
      if (a >= t.morph) return i;
      let o = this.origine(e, n, r);
      return o ? Ot(o, i, C.easeOutQuint(x(a / t.morph))) : i;
    }
    decalageCompose(e) {
      let t = Z.get(this.cur),
        n = this.decalageAtTime(e, this.cur),
        r = e - this.tCur;
      if (r >= t.morph || !this.prev) return n;
      let i = this.decalageFige ?? this.decalageAtTime(e, this.prev),
        a = C.easeOutQuint(x(r / t.morph));
      return {
        x: S(i.x, n.x, a),
        y: S(i.y, n.y, a),
      };
    }
    setState(e, t, n = 0) {
      if (e === this.cur) return;
      let r = Z.get(this.cur).morph,
        i = this.prev !== null && t - this.tCur < r;
      ((this.departFige = i ? this.poseComposee(t) : null),
        (this.decalageFige = i ? this.decalageCompose(t) : null),
        (this.prev = this.cur),
        (this.tPrev = this.tCur),
        (this.previousPosePhase = this.posePhase),
        (this.posePhase = n),
        (this.cur = e),
        (this.tCur = t),
        Z.get(e)?.blinkIn && (this.blinkAt = t));
    }
    sample(e) {
      let t = this.scale,
        n = Z.get(this.cur),
        r = this.shapeAtTime(e),
        i = this.exprAtTime(e),
        a = this.posed(n, Math.max(0, e - this.tCur + this.posePhase), r, i),
        o = this.decalageCompose(e),
        s = e - this.tCur,
        c = s < n.morph ? this.origine(e, r, i) : null;
      if (c) {
        let e = C.easeOutQuint(x(s / n.morph));
        a = Ot(c, a, e);
      }
      let l = a.eyeAlpha > 0.01,
        u = this.lookAtTime(e),
        d = be(e, {
          wander: l ? u.wander : 0,
          blink: l,
        }),
        f = {
          yaw: S(a.gaze.yaw, u.yaw, u.mix) + d.dYaw - u.spin,
          pitch: S(a.gaze.pitch, u.pitch, u.mix) + d.dPitch,
          roll: a.gaze.roll + d.dRoll,
        },
        p = x((e - this.blinkAt) / wt),
        m = p < 1 ? Math.abs(p * 2 - 1) : 1,
        h = Math.min(d.lid, m),
        g = u.blink === void 0 || u.blink === 1 ? h : 1 - (1 - h) * x(u.blink),
        _ = a.offX + d.driftX,
        v = a.offY + d.driftY,
        y = ke(
          W(
            {
              ...a.sil,
              cx: a.sil.cx + _,
              cy: a.sil.cy + v,
              sy: a.sil.sy * d.breath,
            },
            t,
            this.pts,
          ),
        ),
        b = (e, t) => Ae(a.sil.radii, Math.atan2(t, e) - a.sil.rot),
        w = [];
      if (a.eyeAlpha > 0.01) {
        let e = F(f, t, a.split);
        for (let n = 0; n < 2; n++) {
          let r = e[n];
          if (r.depth <= 0.02) continue;
          let i = a.eyes[n],
            s = b(r.x, r.y),
            c = ((i.tilt ?? 0) * Math.PI) / 180,
            l = Math.cos(c),
            u = Math.sin(c),
            d = r.a * l + r.c * u,
            f = r.b * l + r.d * u,
            p = -r.a * u + r.c * l,
            m = -r.b * u + r.d * l,
            h = xe(Math.min(g, i.open));
          w.push({
            d: Fe(i.w * t, i.h * t),
            w: i.w * t,
            h: i.h * t,
            matrix: `matrix(${T(d)},${T(f * h)},${T(p)},${T(m * h)},${T(r.x * s + (_ + o.x) * t)},${T(r.y * s + (v + o.y) * t)})`,
            open: h,
            rest: xe(i.open),
            alpha: a.eyeAlpha * x(r.depth / 0.12),
          });
        }
      }
      let ee = a.dots
          .filter((e) => e.opacity > 0.01 && e.r > 5e-4)
          .map((e) => ({
            ...e,
            x: (e.x + _) * t,
            y: (e.y + v) * t,
            r: e.r * t,
          })),
        te = a.notif ? b(a.notif.x, a.notif.y) : 1,
        E = a.notif ? (a.notif.x * te + _) * t : 0,
        re = a.notif ? (a.notif.y * te + v) * t : 0,
        D = a.notif
          ? {
              x: E,
              y: re,
              r: a.notif.r * t,
            }
          : null,
        O = a.notif
          ? {
              x: E,
              y: re,
              r: a.notif.notch * t,
            }
          : null;
      return {
        bodyPath: y,
        bodyAlpha: a.bodyAlpha,
        eyes: w,
        dots: ee,
        dotsBehind: a.dotsBehind,
        arcs: a.arcs
          .filter((e) => e.opacity > 0.01)
          .map((e) => ne(e.seed, e.t, t, e.id, e.opacity)),
        notif: D,
        notch: O,
      };
    }
  },
  At = 1.1,
  jt = 1.5,
  Mt = (e) => ({
    yaw: 0,
    pitch: 0,
    mix: 0,
    spin: 360 * (1 - C.easeInOutCubic(x(e / jt))),
    wander: 1,
  });
function Nt({ nx: e, ny: t, tour: n, pointer: r }) {
  return {
    yaw: -26 + e * 16,
    pitch: 10 - t * 13,
    mix: n,
    spin: 360 * (1 - n),
    wander: +!r,
  };
}
//#endregion

export {
  kt as BotEngine,
  Ve as SHAPES,
  He as SHAPE_BY_ID,
  z as EXPRESSIONS,
  Se as EXPRESSION_BY_ID,
  Ge as COLOR_BY_ID,
  Z as STATE_BY_ID,
  rt as POSES,
  tt as dotPulse,
};
