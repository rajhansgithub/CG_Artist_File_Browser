// Every half-float bit pattern converted to float once, so reading a half-float sample is an array read
// instead of a Math.pow. Built at load time: 65536 entries, about 1 ms.
// https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
export const HALF_TO_FLOAT = new Float32Array(65536);
for (let binary = 0; binary < 65536; binary++) {
  const exponent = (binary & 0x7c00) >> 10;
  const fraction = binary & 0x03ff;

  HALF_TO_FLOAT[binary] =
    (binary >> 15 ? -1 : 1) *
    (exponent
      ? exponent === 0x1f
        ? fraction
          ? NaN
          : Infinity
        : Math.pow(2, exponent - 15) * (1 + fraction / 0x400)
      : 6.103515625e-5 * (fraction / 0x400));
}

// One value of a decoded image's pixel data as a plain number. Natively decoded half-float images keep their
// samples as half-float bits (`rawIsHalf`); everything else holds floats already.
export function rawSample(info, index) {
  const value = info.rawData[index];
  if (value === undefined) return 0;
  return info.rawIsHalf ? HALF_TO_FLOAT[value] : value;
}
