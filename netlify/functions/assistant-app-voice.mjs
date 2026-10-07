import output from "./bm-voice-output.js";
export default async function handler(request) { return output.voice(request); }
