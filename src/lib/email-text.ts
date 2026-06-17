const WINDOWS_1252_BYTES: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

const MOJIBAKE_PATTERNS = [
  /Ã[\u0080-\u00bf]/g,
  /Â[\s\u00a0\u0080-\u00bf]?/g,
  /â[€\u0080-\u00bf][\u0080-\u00bf]?/g,
  /�/g,
];

function mojibakeScore(value: string) {
  return MOJIBAKE_PATTERNS.reduce((score, pattern) => {
    const matches = value.match(pattern);
    return score + (matches?.length || 0);
  }, 0);
}

function windows1252MojibakeToUtf8(value: string) {
  let hasUnknownHighCodePoint = false;
  const bytes = new Uint8Array(Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    if (code <= 0xff) return code;
    if (WINDOWS_1252_BYTES[character] !== undefined) return WINDOWS_1252_BYTES[character];
    hasUnknownHighCodePoint = true;
    return 0x3f;
  }));

  if (hasUnknownHighCodePoint) return value;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function cleanupEncodingArtifacts(value: string) {
  return value
    .replace(/\u00c2(?=[\s\u00a0])/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

export function repairTextEncoding(value: string) {
  if (!value) return value;

  let best = cleanupEncodingArtifacts(value);
  for (let index = 0; index < 2; index += 1) {
    const currentScore = mojibakeScore(best);
    if (currentScore === 0) break;

    const candidate = cleanupEncodingArtifacts(windows1252MojibakeToUtf8(best));
    const candidateScore = mojibakeScore(candidate);
    const hasTooManyReplacementMarks =
      (candidate.match(/�/g)?.length || 0) > (best.match(/�/g)?.length || 0) + 2;

    if (!hasTooManyReplacementMarks && candidateScore < currentScore) {
      best = candidate;
    } else {
      break;
    }
  }

  return cleanupEncodingArtifacts(best);
}

const QUOTED_HISTORY_PATTERNS = [
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/gim,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/gim,
  /^\s*On\s.+wrote:\s*$/gim,
  /^\s*El\s.+escribi[oó]:\s*$/gim,
  /^\s*Le\s.+a écrit\s*:?\s*$/gim,
  /^\s*Am\s.+schrieb.+:\s*$/gim,
  /^\s*Op\s.+schreef.+:\s*$/gim,
  /^\s*Em\s.+escreveu:\s*$/gim,
  /^\s*Il\s.+ha scritto:\s*$/gim,
  /^\s*De:\s.+$/gim,
  /^\s*From:\s.+$/gim,
  /^\s*发件人:\s.+$/gim,
  /^\s*寄件者:\s.+$/gim,
];

function findQuotedHistoryStart(text: string) {
  let start = -1;

  for (const pattern of QUOTED_HISTORY_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && (start === -1 || match.index < start)) {
      start = match.index;
    }
  }

  return start;
}

export function splitEmailForTranslation(value: string) {
  const text = repairTextEncoding(value).trim();
  const quotedStart = findQuotedHistoryStart(text);

  if (quotedStart <= 0) {
    return {
      currentText: text,
      quotedText: '',
    };
  }

  return {
    currentText: text.slice(0, quotedStart).trim(),
    quotedText: text.slice(quotedStart).trim(),
  };
}
