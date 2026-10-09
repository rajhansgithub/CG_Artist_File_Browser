// Real-time pitch shifter for the audio player (AudioWorklet). It changes pitch without changing speed.
//
// A phase vocoder: each frame is analysed with an FFT, the spectral peaks are moved by the pitch ratio, and the
// frames are rebuilt with overlap-add. Phase is tracked per bin, so a steady tone comes out at the exact
// frequency. The output is delayed by about one frame (roughly 30 ms at 48 kHz), and transients can sound slightly
// smeared, which is normal for this method.
//
// Loaded with audioContext.audioWorklet.addModule(); the worklet is named 'pitch-shifter'.

const FRAME_SIZE = 2048; // FFT length in samples
const OVERSAMPLING = 4; // frame hop is FRAME_SIZE / OVERSAMPLING

// Iterative radix-2 FFT, in place. `inverse` uses the opposite sign and does not scale.
function makeFft(n) {
  const bits = Math.log2(n);
  const reverse = new Uint32Array(n);
  for (let i = 1; i < n; i++) reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) << (bits - 1));
  const cosTable = new Float64Array(n / 2);
  const sinTable = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / n);
    sinTable[i] = Math.sin((2 * Math.PI * i) / n);
  }

  return (re, im, inverse) => {
    for (let i = 0; i < n; i++) {
      const j = reverse[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let j = 0; j < half; j++) {
          const wr = cosTable[j * step];
          const wi = inverse ? sinTable[j * step] : -sinTable[j * step];
          const a = start + j;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

const fft = makeFft(FRAME_SIZE);

class PhaseVocoder {
  constructor() {
    const n = FRAME_SIZE;
    this.n = n;
    this.half = n / 2;
    this.hop = n / OVERSAMPLING;
    this.latency = n - this.hop;
    this.expected = (2 * Math.PI * this.hop) / n; // phase advance of a bin centred on its frequency, per hop

    this.window = new Float64Array(n);
    for (let k = 0; k < n; k++) this.window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n);

    this.inFifo = new Float64Array(n);
    this.outFifo = new Float64Array(this.hop);
    this.outAccum = new Float64Array(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);

    this.lastPhase = new Float64Array(this.half + 1);
    this.sumPhase = new Float64Array(this.half + 1);
    this.anaMagn = new Float64Array(this.half + 1);
    this.anaFreq = new Float64Array(this.half + 1);
    this.synMagn = new Float64Array(this.half + 1);
    this.synFreq = new Float64Array(this.half + 1);

    this.rover = this.latency;
  }

  // Streams one block through the shifter. `ratio` is the pitch factor (2 = one octave up).
  process(input, output, ratio) {
    for (let i = 0; i < output.length; i++) {
      this.inFifo[this.rover] = input[i];
      output[i] = this.outFifo[this.rover - this.latency];
      this.rover++;
      if (this.rover >= this.n) {
        this.rover = this.latency;
        this.processFrame(ratio);
      }
    }
  }

  processFrame(ratio) {
    const { n, half, hop, expected, re, im, window } = this;

    for (let k = 0; k < n; k++) {
      re[k] = this.inFifo[k] * window[k];
      im[k] = 0;
    }
    fft(re, im, false);

    // Analysis: magnitude and true frequency of each bin, from the phase advance since the last frame
    for (let k = 0; k <= half; k++) {
      const magnitude = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const phase = Math.atan2(im[k], re[k]);
      let delta = phase - this.lastPhase[k];
      this.lastPhase[k] = phase;
      delta -= k * expected;

      // Wrap into [-pi, pi]
      let wraps = Math.trunc(delta / Math.PI);
      wraps += wraps >= 0 ? wraps & 1 : -(wraps & 1);
      delta -= Math.PI * wraps;

      this.anaMagn[k] = magnitude;
      this.anaFreq[k] = k + (OVERSAMPLING * delta) / (2 * Math.PI); // in bins
    }

    // Pitch shift: move each bin to its new position
    this.synMagn.fill(0);
    this.synFreq.fill(0);
    for (let k = 0; k <= half; k++) {
      const index = Math.floor(k * ratio);
      if (index <= half) {
        this.synMagn[index] += this.anaMagn[k];
        this.synFreq[index] = this.anaFreq[k] * ratio;
      }
    }

    // Synthesis: rebuild phase from the shifted frequencies
    for (let k = 0; k <= half; k++) {
      let delta = this.synFreq[k] - k;
      delta = (2 * Math.PI * delta) / OVERSAMPLING;
      delta += k * expected;
      this.sumPhase[k] += delta;
      const phase = this.sumPhase[k];
      re[k] = this.synMagn[k] * Math.cos(phase);
      im[k] = this.synMagn[k] * Math.sin(phase);
    }
    // Negative frequencies mirror the positive ones, so the inverse FFT is real
    for (let k = 1; k < half; k++) {
      re[n - k] = re[k];
      im[n - k] = -im[k];
    }

    fft(re, im, true);

    // Scale for the FFT round trip and the 4x overlap, so unity gain comes out at 1.0
    const scale = 2 / (half * OVERSAMPLING) / 3;
    for (let k = 0; k < n; k++) this.outAccum[k] += window[k] * re[k] * scale;

    // Hand the finished hop to the output and slide the buffers along
    for (let k = 0; k < hop; k++) this.outFifo[k] = this.outAccum[k];
    this.outAccum.copyWithin(0, hop);
    this.outAccum.fill(0, n - hop);
    this.inFifo.copyWithin(0, hop, n);
  }
}

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.shifters = [];
    this.silence = new Float32Array(128);
    // Slow power averages of the input and the shifted output (about half a second each)
    this.inPower = 0;
    this.outPower = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channels = output.length;
    if (this.shifters.length !== channels) {
      this.shifters = Array.from({ length: channels }, () => new PhaseVocoder());
    }

    const ratio = parameters.ratio[0];
    for (let ch = 0; ch < channels; ch++) {
      // A mono source feeds both output channels
      const inputChannel = input && input.length ? input[Math.min(ch, input.length - 1)] : this.silence;
      this.shifters[ch].process(inputChannel, output[ch], ratio);
    }

    // The shifter's level moves with the pitch, so track the level against the input and correct it
    const block = output[0].length;
    const smoothing = Math.exp(-block / (0.5 * sampleRate));
    let inSum = 0;
    let outSum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const inputChannel = input && input.length ? input[Math.min(ch, input.length - 1)] : this.silence;
      for (let i = 0; i < block; i++) {
        inSum += inputChannel[i] * inputChannel[i];
        outSum += output[ch][i] * output[ch][i];
      }
    }
    this.inPower = smoothing * this.inPower + (1 - smoothing) * (inSum / (block * channels));
    this.outPower = smoothing * this.outPower + (1 - smoothing) * (outSum / (block * channels));

    let gain = 1;
    if (this.inPower > 1e-10 && this.outPower > 1e-10) {
      gain = Math.min(2, Math.max(0.5, Math.sqrt(this.inPower / this.outPower)));
    }
    // The shifted signal can overshoot full scale by about a decibel, so keep it inside the range
    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < block; i++) {
        output[ch][i] = Math.max(-1, Math.min(1, output[ch][i] * gain));
      }
    }

    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
