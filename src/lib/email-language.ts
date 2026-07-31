type LanguageMarkers = {
  code: string;
  words: readonly string[];
  phrases?: readonly string[];
};

const LATIN_LANGUAGE_MARKERS: readonly LanguageMarkers[] = [
  {
    code: 'de',
    words: [
      'aber', 'auch', 'bereits', 'danke', 'damit', 'deine', 'deinen', 'dieser',
      'dieses', 'einem', 'einen', 'einer', 'euch', 'gerne', 'hallo', 'kann',
      'können', 'könnte', 'möchte', 'nicht', 'unsere', 'unser', 'vielen',
      'werden', 'würde', 'über',
    ],
    phrases: ['vielen dank', 'ich würde', 'für deine', 'für eure', 'mit freundlichen grüßen'],
  },
  {
    code: 'en',
    words: [
      'about', 'also', 'and', 'are', 'could', 'have', 'hello', 'please', 'thank',
      'thanks', 'that', 'the', 'this', 'our', 'with', 'would', 'your',
    ],
    phrases: ['thank you', 'best regards', 'looking forward', 'would like'],
  },
  {
    code: 'es',
    words: [
      'además', 'aunque', 'como', 'con', 'gracias', 'hola', 'nuestro', 'nuestra',
      'para', 'pero', 'podemos', 'puede', 'porque', 'sería', 'también', 'vuestra',
    ],
    phrases: ['muchas gracias', 'un saludo', 'por favor', 'nos gustaría'],
  },
  {
    code: 'nl',
    words: [
      'bedankt', 'deze', 'graag', 'hebben', 'het', 'jullie', 'kunnen', 'maar',
      'met', 'niet', 'ook', 'voor', 'wij', 'zijn', 'zou',
    ],
    phrases: ['hartelijk dank', 'met vriendelijke groet', 'ik zou', 'we kunnen'],
  },
  {
    code: 'pt',
    words: [
      'ainda', 'como', 'com', 'gostaria', 'muito', 'não', 'nosso', 'nossa',
      'obrigado', 'obrigada', 'para', 'podemos', 'porque', 'também', 'vocês',
    ],
    phrases: ['muito obrigado', 'muito obrigada', 'por favor', 'um abraço'],
  },
  {
    code: 'fr',
    words: [
      'avec', 'bonjour', 'cette', 'comme', 'dans', 'merci', 'mais', 'nous',
      'notre', 'pas', 'pour', 'pouvez', 'serait', 'votre', 'vous',
    ],
    phrases: ['merci beaucoup', 'bien cordialement', 'nous pouvons', 'je voudrais'],
  },
  {
    code: 'pl',
    words: [
      'bardzo', 'będzie', 'chciałbym', 'chciałabym', 'dziękuję', 'dla', 'jest',
      'możemy', 'nasz', 'nasza', 'nie', 'oraz', 'proszę', 'również', 'zainteresowany',
    ],
    phrases: ['bardzo dziękuję', 'z poważaniem', 'dzień dobry', 'chcielibyśmy'],
  },
  {
    code: 'it',
    words: [
      'anche', 'buongiorno', 'come', 'con', 'grazie', 'nostro', 'nostra', 'per',
      'perché', 'possiamo', 'potrebbe', 'questa', 'questo', 'sarebbe', 'vorrei',
    ],
    phrases: ['grazie mille', 'cordiali saluti', 'per favore', 'vorremmo'],
  },
  {
    code: 'sv',
    words: [
      'också', 'för', 'gärna', 'hej', 'inte', 'kan', 'med', 'mycket', 'skulle',
      'tack', 'vår', 'vårt',
    ],
    phrases: ['tack så mycket', 'med vänliga hälsningar', 'jag skulle'],
  },
  {
    code: 'da',
    words: [
      'gerne', 'hej', 'ikke', 'kan', 'mange', 'med', 'også', 'skulle', 'tak',
      'vores', 'være',
    ],
    phrases: ['mange tak', 'med venlig hilsen', 'jeg vil gerne'],
  },
  {
    code: 'no',
    words: [
      'gjerne', 'hei', 'ikke', 'kan', 'med', 'også', 'skulle', 'takk', 'vår',
      'være',
    ],
    phrases: ['tusen takk', 'med vennlig hilsen', 'jeg vil gjerne'],
  },
  {
    code: 'fi',
    words: [
      'että', 'haluaisin', 'hei', 'kiitos', 'kanssa', 'meidän', 'myös', 'olisi',
      'voimme', 'voisi',
    ],
    phrases: ['paljon kiitoksia', 'ystävällisin terveisin', 'haluaisimme'],
  },
  {
    code: 'ro',
    words: [
      'această', 'acest', 'avem', 'bună', 'foarte', 'mulțumesc', 'noastră',
      'nostru', 'pentru', 'putem', 'și',
    ],
    phrases: ['vă mulțumesc', 'cu stimă', 'am dori'],
  },
  {
    code: 'cs',
    words: [
      'bych', 'děkuji', 'dobrý', 'můžeme', 'naše', 'není', 'prosím', 'pro',
      'také', 'velmi',
    ],
    phrases: ['děkuji vám', 's pozdravem', 'rádi bychom'],
  },
  {
    code: 'hu',
    words: [
      'együtt', 'köszönöm', 'lehet', 'nagyon', 'nem', 'szeretnék', 'tudunk',
      'üdvözlettel',
    ],
    phrases: ['nagyon köszönöm', 'szeretnénk', 'üdvözlettel'],
  },
  {
    code: 'tr',
    words: [
      'bizim', 'birlikte', 'değil', 'için', 'ile', 'merhaba', 'çok', 'teşekkürler',
      'yapabiliriz', 'isteriz',
    ],
    phrases: ['çok teşekkürler', 'iyi çalışmalar', 'iş birliği'],
  },
];

const DIACRITIC_SCORES: ReadonlyArray<readonly [string, RegExp, number]> = [
  ['de', /[äöüß]/gi, 3],
  ['es', /[¿¡ñ]/gi, 3],
  ['pt', /[ãõ]/gi, 3],
  ['pl', /[ąćęłńśźż]/gi, 3],
  ['ro', /[ăâîșț]/gi, 3],
  ['cs', /[čďěňřšťůž]/gi, 3],
  ['hu', /[őű]/gi, 3],
  ['tr', /[ğış]/gi, 3],
  ['da', /[æø]/gi, 2],
  ['no', /[æø]/gi, 2],
];

function countMatches(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return text.match(pattern)?.length || 0;
}

export function detectEmailLanguage(text: string): string {
  const sample = String(text || '')
    .normalize('NFKC')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, ' ')
    .slice(0, 8_000)
    .toLowerCase();

  if (!sample.trim()) return '';
  if (/[\u3040-\u30ff]/.test(sample)) return 'ja';
  if (/[\uac00-\ud7af]/.test(sample)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(sample)) return 'zh';
  if (/[\u0600-\u06ff]/.test(sample)) return 'ar';
  if (/[\u0370-\u03ff]/.test(sample)) return 'el';
  if (/[іїєґ]/i.test(sample)) return 'uk';
  if (/[\u0400-\u04ff]/.test(sample)) return 'ru';

  const tokens = sample.match(/\p{L}+/gu) || [];
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) {
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }

  const scores = new Map<string, number>();
  for (const language of LATIN_LANGUAGE_MARKERS) {
    let score = 0;
    for (const word of language.words) {
      score += Math.min(tokenCounts.get(word) || 0, 2);
    }
    for (const phrase of language.phrases || []) {
      if (sample.includes(phrase)) score += 3;
    }
    scores.set(language.code, score);
  }

  for (const [code, pattern, weight] of DIACRITIC_SCORES) {
    const matches = countMatches(sample, pattern);
    if (matches) scores.set(code, (scores.get(code) || 0) + Math.min(matches, 3) * weight);
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const [bestCode, bestScore] = ranked[0] || ['', 0];
  const secondScore = ranked[1]?.[1] || 0;
  if (bestScore >= 2 && (bestScore >= 4 || bestScore > secondScore)) return bestCode;

  return /[a-z]/i.test(sample) ? 'en' : '';
}
