class CaviAudioRecorder extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) {
      const copy = channel.slice();
      this.port.postMessage(copy, [copy.buffer]);
    }
    for (const output of outputs[0] || []) output.fill(0);
    return true;
  }
}

registerProcessor("cavi-audio-recorder", CaviAudioRecorder);
