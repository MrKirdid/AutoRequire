/**
 * Advanced fuzzy matching algorithms for typo-tolerant search
 * Combines multiple techniques for better accuracy with large typos
 */

/**
 * Calculate the Levenshtein (edit) distance between two strings
 * This handles character swaps, insertions, deletions
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Quick checks
  if (m === 0) return n;
  if (n === 0) return m;

  // Create distance matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Damerau-Levenshtein: handle transpositions (adjacent swaps)
      if (i > 1 && j > 1 && 
          str1[i - 1] === str2[j - 2] && 
          str1[i - 2] === str2[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate normalized Levenshtein similarity (0 to 1, higher is better)
 */
export function levenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  return 1 - (levenshteinDistance(str1, str2) / maxLen);
}

/**
 * Check if query characters appear in order in the target (subsequence match)
 * Returns the number of matched characters
 */
export function subsequenceMatch(query: string, target: string): { matched: number; gaps: number; positions: number[] } {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  
  let queryIdx = 0;
  let lastMatchPos = -1;
  let gaps = 0;
  const positions: number[] = [];

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      if (lastMatchPos !== -1 && i > lastMatchPos + 1) {
        gaps += i - lastMatchPos - 1;
      }
      positions.push(i);
      lastMatchPos = i;
      queryIdx++;
    }
  }

  return { matched: queryIdx, gaps, positions };
}

/**
 * Calculate character frequency similarity
 * Useful when characters are correct but order is very wrong
 */
export function characterFrequencySimilarity(str1: string, str2: string): number {
  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();

  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  for (const c of s1) {
    freq1.set(c, (freq1.get(c) || 0) + 1);
  }
  for (const c of s2) {
    freq2.set(c, (freq2.get(c) || 0) + 1);
  }

  // Calculate intersection
  let commonCount = 0;
  for (const [char, count] of freq1) {
    commonCount += Math.min(count, freq2.get(char) || 0);
  }

  const totalChars = Math.max(s1.length, s2.length);
  if (totalChars === 0) return 1;

  return commonCount / totalChars;
}

/**
 * QWERTY keyboard proximity map for detecting adjacent key typos
 */
const keyboardProximity: Map<string, string[]> = new Map([
  ['q', ['w', 'a', 's']],
  ['w', ['q', 'e', 'a', 's', 'd']],
  ['e', ['w', 'r', 's', 'd', 'f']],
  ['r', ['e', 't', 'd', 'f', 'g']],
  ['t', ['r', 'y', 'f', 'g', 'h']],
  ['y', ['t', 'u', 'g', 'h', 'j']],
  ['u', ['y', 'i', 'h', 'j', 'k']],
  ['i', ['u', 'o', 'j', 'k', 'l']],
  ['o', ['i', 'p', 'k', 'l']],
  ['p', ['o', 'l']],
  ['a', ['q', 'w', 's', 'z', 'x']],
  ['s', ['q', 'w', 'e', 'a', 'd', 'z', 'x', 'c']],
  ['d', ['w', 'e', 'r', 's', 'f', 'x', 'c', 'v']],
  ['f', ['e', 'r', 't', 'd', 'g', 'c', 'v', 'b']],
  ['g', ['r', 't', 'y', 'f', 'h', 'v', 'b', 'n']],
  ['h', ['t', 'y', 'u', 'g', 'j', 'b', 'n', 'm']],
  ['j', ['y', 'u', 'i', 'h', 'k', 'n', 'm']],
  ['k', ['u', 'i', 'o', 'j', 'l', 'm']],
  ['l', ['i', 'o', 'p', 'k']],
  ['z', ['a', 's', 'x']],
  ['x', ['a', 's', 'd', 'z', 'c']],
  ['c', ['s', 'd', 'f', 'x', 'v']],
  ['v', ['d', 'f', 'g', 'c', 'b']],
  ['b', ['f', 'g', 'h', 'v', 'n']],
  ['n', ['g', 'h', 'j', 'b', 'm']],
  ['m', ['h', 'j', 'k', 'n']],
]);

/**
 * Check if two characters are adjacent on the keyboard
 */
export function areKeysAdjacent(char1: string, char2: string): boolean {
  const c1 = char1.toLowerCase();
  const c2 = char2.toLowerCase();
  const adjacent = keyboardProximity.get(c1);
  return adjacent ? adjacent.includes(c2) : false;
}

/**
 * Calculate a weighted edit distance that considers keyboard proximity
 */
export function keyboardAwareDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c1 = str1[i - 1].toLowerCase();
      const c2 = str2[j - 1].toLowerCase();

      let cost: number;
      if (c1 === c2) {
        cost = 0;
      } else if (areKeysAdjacent(c1, c2)) {
        cost = 0.5; // Half penalty for adjacent key mistakes
      } else {
        cost = 1;
      }

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      // Transposition
      if (i > 1 && j > 1 && 
          str1[i - 1].toLowerCase() === str2[j - 2].toLowerCase() && 
          str1[i - 2].toLowerCase() === str2[j - 1].toLowerCase()) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 0.5);
      }
    }
  }

  return dp[m][n];
}

/**
 * Combined fuzzy match score (0 to 1, higher is better)
 * Combines multiple matching strategies for robust typo tolerance
 */
export interface FuzzyMatchResult {
  score: number;
  isMatch: boolean;
  matchType: 'exact' | 'prefix' | 'substring' | 'subsequence' | 'fuzzy' | 'none';
}

export interface FuzzyMatchOptions {
  /** Minimum score to be considered a match (0-1) */
  minScore: number;
  /** Weight for Levenshtein similarity (0-1) */
  levenshteinWeight: number;
  /** Weight for subsequence matching (0-1) */
  subsequenceWeight: number;
  /** Weight for character frequency (0-1) */
  frequencyWeight: number;
  /** Bonus for prefix matches */
  prefixBonus: number;
  /** Allow very fuzzy matches (good for large typos) */
  allowVeryFuzzy: boolean;
}

const defaultOptions: FuzzyMatchOptions = {
  minScore: 0.3,
  levenshteinWeight: 0.4,
  subsequenceWeight: 0.35,
  frequencyWeight: 0.25,
  prefixBonus: 0.15,
  allowVeryFuzzy: true,
};

export function fuzzyMatch(query: string, target: string, options: Partial<FuzzyMatchOptions> = {}): FuzzyMatchResult {
  const opts = { ...defaultOptions, ...options };
  
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Empty query matches everything with low score
  if (queryLower.length === 0) {
    return { score: 0.1, isMatch: true, matchType: 'fuzzy' };
  }

  // Exact match
  if (queryLower === targetLower) {
    return { score: 1.0, isMatch: true, matchType: 'exact' };
  }

  // Prefix match
  if (targetLower.startsWith(queryLower)) {
    const lengthRatio = queryLower.length / targetLower.length;
    return { 
      score: 0.9 + (lengthRatio * 0.1), 
      isMatch: true, 
      matchType: 'prefix' 
    };
  }

  // Substring match
  if (targetLower.includes(queryLower)) {
    const lengthRatio = queryLower.length / targetLower.length;
    return { 
      score: 0.7 + (lengthRatio * 0.2), 
      isMatch: true, 
      matchType: 'substring' 
    };
  }

  // Combined fuzzy scoring
  let score = 0;

  // 1. Levenshtein-based similarity with keyboard awareness
  const keyboardDist = keyboardAwareDistance(queryLower, targetLower);
  const maxLen = Math.max(queryLower.length, targetLower.length);
  const levenshteinScore = 1 - (keyboardDist / maxLen);
  score += levenshteinScore * opts.levenshteinWeight;

  // 2. Subsequence matching (characters in order)
  const subseq = subsequenceMatch(queryLower, targetLower);
  const subsequenceScore = subseq.matched / queryLower.length;
  const gapPenalty = subseq.gaps > 0 ? Math.min(0.3, subseq.gaps * 0.02) : 0;
  score += (subsequenceScore - gapPenalty) * opts.subsequenceWeight;

  // 3. Character frequency similarity
  const freqScore = characterFrequencySimilarity(queryLower, targetLower);
  score += freqScore * opts.frequencyWeight;

  // 4. Bonus for matching first character
  if (queryLower[0] === targetLower[0]) {
    score += opts.prefixBonus;
  }

  // 5. Length similarity bonus (penalize very different lengths)
  const lengthRatio = Math.min(queryLower.length, targetLower.length) / 
                     Math.max(queryLower.length, targetLower.length);
  score *= (0.7 + (lengthRatio * 0.3));

  // Normalize score to 0-1 range
  score = Math.min(1, Math.max(0, score));

  // Determine match type
  let matchType: FuzzyMatchResult['matchType'] = 'none';
  if (subsequenceScore >= 0.8) {
    matchType = 'subsequence';
  } else if (score >= opts.minScore) {
    matchType = 'fuzzy';
  }

  // For very fuzzy mode, allow matches with high character overlap even if order is wrong
  if (opts.allowVeryFuzzy && freqScore >= 0.7 && score < opts.minScore) {
    score = Math.max(score, freqScore * 0.5);
    matchType = 'fuzzy';
  }

  return {
    score,
    isMatch: score >= opts.minScore,
    matchType,
  };
}

/**
 * Score and rank multiple targets against a query
 */
export interface RankedMatch<T> {
  item: T;
  score: number;
  matchType: FuzzyMatchResult['matchType'];
}

export function rankMatches<T>(
  query: string,
  items: T[],
  getSearchText: (item: T) => string | string[],
  options: Partial<FuzzyMatchOptions> = {}
): RankedMatch<T>[] {
  const results: RankedMatch<T>[] = [];

  for (const item of items) {
    const searchTexts = getSearchText(item);
    const textsArray = Array.isArray(searchTexts) ? searchTexts : [searchTexts];
    
    let bestScore = 0;
    let bestMatchType: FuzzyMatchResult['matchType'] = 'none';

    for (const text of textsArray) {
      const result = fuzzyMatch(query, text, options);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestMatchType = result.matchType;
      }
    }

    if (bestMatchType !== 'none') {
      results.push({ item, score: bestScore, matchType: bestMatchType });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}
