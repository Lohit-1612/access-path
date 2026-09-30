// Multilingual Voice & Audio Accessibility System for AccessPath
// Supports: English, Tamil (தமிழ்), Hindi (हिन्दी), Telugu (తెలుగు), Spanish (Español), French (Français), German (Deutsch)

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', bcp47: 'en-US' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', bcp47: 'es-ES' },
  { code: 'fr', name: 'French', nativeName: 'Français', bcp47: 'fr-FR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', bcp47: 'de-DE' }
];

export const DEFAULT_LANGUAGE = 'en';

// Translate dynamic navigation instructions into the user's selected language
export function translateInstruction(instruction: string, langCode: string = 'en'): string {
  if (!instruction || langCode === 'en') return instruction;

  const lower = instruction.toLowerCase();

  // Extract distance if present (e.g. "(45m)")
  const distMatch = instruction.match(/\((\d+)\s*m\)/i);
  const dist = distMatch ? distMatch[1] : '';

  // 1. Arrival announcement
  if (lower.includes('you have arrived') || lower.includes('arrived at your destination')) {
    const destMatch = instruction.split(/destination:?/i)[1]?.trim() || '';
    const destClean = destMatch.replace(/\.?\s*$/, '');
    switch (langCode) {
      case 'ta':
        return `நீங்கள் உங்கள் இலக்கை அடைந்துவிட்டீர்கள்${destClean ? ': ' + destClean : ''}.`;
      case 'hi':
        return `आप अपने गंतव्य पर पहुँच गए हैं${destClean ? ': ' + destClean : ''}।`;
      case 'te':
        return `మీరు మీ గమ్యాన్ని చేరుకున్నారు${destClean ? ': ' + destClean : ''}.`;
      case 'es':
        return `Ha llegado a su destino${destClean ? ': ' + destClean : ''}.`;
      case 'fr':
        return `Vous êtes arrivé à votre destination${destClean ? ': ' + destClean : ''}.`;
      case 'de':
        return `Sie haben Ihr Ziel erreicht${destClean ? ': ' + destClean : ''}.`;
    }
  }

  // 2. Approach destination
  if (lower.includes('approach destination') || lower.includes('towards destination')) {
    const destPart = instruction.split(/destination:?/i)[1]?.split('(')[0]?.trim() || 'destination';
    switch (langCode) {
      case 'ta':
        return `${destPart} நோக்கி செல்லவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${destPart} की ओर बढ़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${destPart} వైపు వెళ్లండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Acérquese a ${destPart} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Approchez de ${destPart} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Gehen Sie auf ${destPart} zu ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 3. Turn Left
  if (lower.includes('turn left') || lower.includes('sharp left')) {
    const onto = extractTargetStreet(instruction);
    switch (langCode) {
      case 'ta':
        return `${onto ? onto + ' நோக்கி ' : ''}இடதுபுறம் திரும்பவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${onto ? onto + ' पर ' : ''}बाएं मुड़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${onto ? onto + ' పై ' : ''}ఎడమవైపు తిరగండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Gire a la izquierda ${onto ? 'hacia ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Tournez à gauche ${onto ? 'sur ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Biegen Sie links ab ${onto ? 'auf ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 4. Turn Right
  if (lower.includes('turn right') || lower.includes('sharp right')) {
    const onto = extractTargetStreet(instruction);
    switch (langCode) {
      case 'ta':
        return `${onto ? onto + ' நோக்கி ' : ''}வலதுபுறம் திரும்பவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${onto ? onto + ' पर ' : ''}दाएं मुड़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${onto ? onto + ' పై ' : ''}కుడివైపు తిరగండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Gire a la derecha ${onto ? 'hacia ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Tournez à droite ${onto ? 'sur ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Biegen Sie rechts ab ${onto ? 'auf ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 5. Slight Left
  if (lower.includes('slight left')) {
    const onto = extractTargetStreet(instruction);
    switch (langCode) {
      case 'ta':
        return `${onto ? onto + ' நோக்கி ' : ''}சிறிது இடதுபுறம் செல்லவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${onto ? onto + ' पर ' : ''}हल्का बाएं मुड़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${onto ? onto + ' పై ' : ''}కొద్దిగా ఎడమవైపు వెళ్లండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Gire ligeramente a la izquierda ${onto ? 'hacia ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Légèrement à gauche ${onto ? 'sur ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Halten Sie sich leicht links ${onto ? 'auf ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 6. Slight Right
  if (lower.includes('slight right')) {
    const onto = extractTargetStreet(instruction);
    switch (langCode) {
      case 'ta':
        return `${onto ? onto + ' நோக்கி ' : ''}சிறிது வலதுபுறம் செல்லவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${onto ? onto + ' पर ' : ''}हल्का दाएं मुड़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${onto ? onto + ' పై ' : ''}కొద్దిగా కుడివైపు వెళ్లండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Gire ligeramente a la derecha ${onto ? 'hacia ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Légèrement à droite ${onto ? 'sur ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Halten Sie sich leicht rechts ${onto ? 'auf ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 7. Continue straight / Follow path
  if (lower.includes('continue straight') || lower.includes('follow') || lower.includes('head ')) {
    const onto = extractTargetStreet(instruction);
    switch (langCode) {
      case 'ta':
        return `${onto ? onto + ' வழியே ' : ''}நேராக தொடரவும் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `${onto ? onto + ' पर ' : ''}सीधे आगे बढ़ें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `${onto ? onto + ' లో ' : ''}నేరుగా ముందుకు వెళ్లండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Continúe recto ${onto ? 'por ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Continuez tout droit ${onto ? 'sur ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Geradeaus weitergehen ${onto ? 'auf ' + onto : ''} ${dist ? `(${dist}m)` : ''}`;
    }
  }

  // 8. Depart from GPS location
  if (lower.includes('depart from your real-time gps')) {
    switch (langCode) {
      case 'ta':
        return `உங்கள் தற்போதைய இடத்திலிருந்து நடைபாதையை நோக்கி தொடங்குங்கள் ${dist ? `(${dist} மீட்டர்)` : ''}`;
      case 'hi':
        return `अपने वर्तमान स्थान से सुगम मार्ग की ओर प्रस्थान करें ${dist ? `(${dist} मीटर)` : ''}`;
      case 'te':
        return `మీ ప్రస్తుత స్థానం నుండి నడక మార్గం వైపు ప్రారంభించండి ${dist ? `(${dist} మీటర్లు)` : ''}`;
      case 'es':
        return `Comience desde su ubicación GPS hacia la ruta accesible ${dist ? `(${dist}m)` : ''}`;
      case 'fr':
        return `Partez de votre position GPS vers la voie accessible ${dist ? `(${dist}m)` : ''}`;
      case 'de':
        return `Starten Sie von Ihrem GPS-Standort zum barrierefreien Weg ${dist ? `(${dist}m)` : ''}`;
    }
  }

  return instruction;
}

function extractTargetStreet(instruction: string): string {
  const match = instruction.match(/(?:onto|on|follow)\s+([^towards(]+)/i);
  return match ? match[1].trim() : '';
}

// Speak turn or alert using SpeechSynthesis
export function speakText(text: string, langCode: string = 'en', onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const langObj = SUPPORTED_LANGUAGES.find((l) => l.code === langCode) || SUPPORTED_LANGUAGES[0];
    utterance.lang = langObj.bcp47;
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    // Pick best matching voice
    const voices = window.speechSynthesis.getVoices();
    const matchingVoice = voices.find((v) =>
      v.lang.toLowerCase().replace('_', '-').startsWith(langObj.bcp47.toLowerCase().split('-')[0])
    );
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    if (onEnd) {
      utterance.onend = onEnd;
    }

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis error:', e);
  }
}

// Play audio alert tone for obstacle detection (Web Audio API Synthesizer)
export function playAlertSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Two-tone warning chime
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn('Web Audio error:', e);
  }
}

// Trigger haptic vibration for blind navigation
export function triggerHapticAlert() {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([200, 100, 200, 100, 300]);
    } catch (e) {
      console.warn('Haptic vibrate error:', e);
    }
  }
}
