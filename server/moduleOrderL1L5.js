'use strict';

/**
 * Module Completion schedule order — Levels 1–5 only.
 * Per floor (1–4): pod (x49–x52) → right stack (x01–x08) → corridor zigzag → inner zigzag → far-left column.
 * Level 5: corridor zigzag (501–511 / 530–522A) then left wing.
 */

function mod(floor, num, suffix = '') {
  return `${floor}${String(num).padStart(2, '0')}${suffix}`;
}

function zigzagRows(top, bottom) {
  const out = [];
  const len = Math.max(top.length, bottom.length);
  for (let i = 0; i < len; i++) {
    if (i < top.length) out.push(top[i]);
    if (i < bottom.length) out.push(bottom[i]);
  }
  return out;
}

function corridorZigzag(floor) {
  const top = [];
  for (let n = 9; n <= 19; n++) top.push(mod(floor, n));
  const bottom = [];
  for (let n = 48; n >= 43; n--) bottom.push(mod(floor, n));
  bottom.push(
    mod(floor, 42, 'B'),
    mod(floor, 42, 'A'),
    mod(floor, 41, 'B'),
    mod(floor, 41, 'A'),
    mod(floor, 40, 'B'),
    mod(floor, 40, 'A')
  );
  return zigzagRows(top, bottom);
}

function standardFloor(floor) {
  const pod = [mod(floor, 49), mod(floor, 50), mod(floor, 51), mod(floor, 52)];
  const right = [];
  for (let n = 1; n <= 8; n++) right.push(mod(floor, n));
  const corridor = corridorZigzag(floor);
  const inner = zigzagRows(
    [mod(floor, 20), mod(floor, 21), mod(floor, 22), mod(floor, 23)],
    [mod(floor, 39), mod(floor, 38), mod(floor, 37)]
  );
  const farLeft = [];
  for (let n = 24; n <= 36; n++) farLeft.push(mod(floor, n));
  return [...pod, ...right, ...corridor, ...inner, ...farLeft];
}

function floor5() {
  const top = [];
  for (let n = 1; n <= 11; n++) top.push(mod(5, n));
  const bottom = [];
  for (let n = 30; n >= 25; n--) bottom.push(mod(5, n));
  bottom.push(
    mod(5, 24, 'B'),
    mod(5, 24, 'A'),
    mod(5, 23, 'B'),
    mod(5, 23, 'A'),
    mod(5, 22, 'B'),
    mod(5, 22, 'A')
  );
  const corridor = zigzagRows(top, bottom);
  const left = [
    mod(5, 19),
    mod(5, 18),
    mod(5, 17),
    mod(5, 16),
    mod(5, 15),
    mod(5, 14),
    mod(5, 13),
    mod(5, 12),
    mod(5, 21),
    mod(5, 20),
  ];
  return [...corridor, ...left];
}

const MODULE_ORDER_L1_L5 = [
  ...standardFloor(1),
  ...standardFloor(2),
  ...standardFloor(3),
  ...standardFloor(4),
  ...floor5(),
];

module.exports = { MODULE_ORDER_L1_L5, standardFloor, floor5, mod };
