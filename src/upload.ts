import * as XLSX from 'xlsx';
import { inferAspectFromText, inferSentimentFromText } from './absa';
import { ReviewImportResult, ReviewRecord, Sentiment } from './types';

const textKeys = ['text', '评论', '评论内容', 'content', 'review', '原始评论', '评论文本', 'comment_text', 'comment'];
const modelKeys = ['车型', '车系', 'series_name', 'model', 'carModel'];
const platformKeys = ['平台', '来源', 'source', 'platform'];
const dateKeys = ['时间', '日期', 'date', 'created_at', 'pub_time', 'time'];
const sentimentKeys = ['情感', '情感极性', 'label', 'sentiment'];
const scoreKeys = ['评分', 'score', 'user_score', 'comment_score', 'star'];
const ignoredTextKeys = ['index', 'id', 'comment_id', 'label', '车型', '车系', '来源', '平台', 'model', 'source', 'platform', 'score', 'user_score', 'comment_score', 'pub_time', 'date', 'price', 'price_range'];
const qualityKeywordPattern = /续航|油耗|电耗|操控|动力|车机|座舱|中控|空间|内饰|外观|悬架|悬挂|减震|底盘|充电|智驾|雷达|售后|配置|舒适|噪声|异响|性价比|刹车|制动|座椅|空调|发动机/;
const mojibakePattern = /[åæçèéäöüÂÃ¤¦§¨©«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]|�/;
const idLikePattern = /^(NEV|EV|ID|NO|ROW)?[_-]?\d{3,}$/i;

function decodeText(buffer: ArrayBuffer) {
  const decoders = ['utf-8', 'utf-8-sig', 'gbk', 'gb18030', 'utf-16le'];
  const decoded = decoders.map((encoding) => {
    try {
      const text = encoding === 'utf-8-sig' ? new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '') : new TextDecoder(encoding).decode(buffer);
      const replacementCount = (text.match(/\uFFFD/g) || []).length;
      const mojibakeCount = (text.match(mojibakePattern) || []).length;
      return { text, score: replacementCount * 4 + mojibakeCount };
    } catch {
      return { text: '', score: Number.POSITIVE_INFINITY };
    }
  });
  return decoded.sort((a, b) => a.score - b.score)[0].text;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

function pick(row: Record<string, unknown>, keys: string[]) {
  const matched = Object.keys(row).find((key) => keys.some((candidate) => normalizeKey(key).includes(normalizeKey(candidate))));
  return matched ? String(row[matched] ?? '') : '';
}

function parseSentiment(value: string, text: string, scoreValue = ''): Sentiment {
  const raw = value.trim().toLowerCase();
  if (['1', 'positive', '正面', '积极'].some((key) => raw.includes(key))) return 'positive';
  if (['0', '-1', 'negative', '负面', '消极'].some((key) => raw.includes(key))) return 'negative';
  if (['neutral', '中性'].some((key) => raw.includes(key))) return 'neutral';
  const numericScore = Number(scoreValue || raw);
  if (Number.isFinite(numericScore)) {
    if (numericScore <= 5) {
      if (numericScore >= 4) return 'positive';
      if (numericScore <= 2.5) return 'negative';
    } else {
      if (numericScore >= 70) return 'positive';
      if (numericScore <= 45) return 'negative';
    }
  }
  return inferSentimentFromText(text);
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) || '';
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  return '\t';
}

function splitLine(line: string, delimiter: string) {
  if (delimiter === '\t') return line.split('\t');
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else current += char;
  }
  result.push(current);
  return result.map((item) => item.trim().replace(/^"|"$/g, ''));
}

function parseTextRows(content: string) {
  const delimiter = detectDelimiter(content);
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = splitLine(lines[0], delimiter).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = splitLine(line, delimiter);
    return header.reduce<Record<string, unknown>>((row, key, index) => {
      row[key || `col_${index}`] = values[index] || '';
      return row;
    }, {});
  });
}

function textColumnScore(key: string, values: string[]) {
  const normalizedKey = normalizeKey(key);
  if (ignoredTextKeys.some((item) => normalizedKey === normalizeKey(item) || normalizedKey.includes(normalizeKey(item)))) return -10000;
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  const sampleValues = nonEmpty.slice(0, 80);
  const sample = sampleValues.join('');
  const chineseCount = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
  const keywordCount = (sample.match(qualityKeywordPattern) || []).length;
  const digitCount = (sample.match(/\d/g) || []).length;
  const avgLength = sampleValues.length ? sampleValues.reduce((sum, item) => sum + item.length, 0) / sampleValues.length : 0;
  const longTextRatio = sampleValues.length ? sampleValues.filter((item) => item.length >= 8 && !idLikePattern.test(item)).length / sampleValues.length : 0;
  const idLikeRatio = sampleValues.length ? sampleValues.filter((item) => idLikePattern.test(item)).length / sampleValues.length : 1;
  const exactKeyBonus = textKeys.some((candidate) => normalizedKey === normalizeKey(candidate)) ? 700 : 0;
  const partialKeyBonus = textKeys.some((candidate) => normalizedKey.includes(normalizeKey(candidate))) ? 260 : 0;
  return exactKeyBonus + partialKeyBonus + chineseCount * 2 + keywordCount * 40 + avgLength * 4 + longTextRatio * 220 - digitCount * 0.5 - idLikeRatio * 800;
}

function chooseTextKey(rows: Record<string, unknown>[]) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const validKeys = keys.filter((key) => !ignoredTextKeys.some((item) => normalizeKey(key) === normalizeKey(item) || normalizeKey(key).includes(normalizeKey(item))));
  const direct = validKeys
    .filter((key) => textKeys.some((candidate) => normalizeKey(key) === normalizeKey(candidate)))
    .map((key) => ({ key, score: textColumnScore(key, rows.map((row) => String(row[key] ?? ''))) }))
    .sort((a, b) => b.score - a.score)[0];
  if (direct && direct.score >= 260) return { key: direct.key, confident: true };
  const best = keys
    .map((key) => ({ key, score: textColumnScore(key, rows.map((row) => String(row[key] ?? ''))) }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? { key: best.key, confident: best.score >= 260 } : { key: undefined, confident: false };
}

export function parseReviewRows(rows: Record<string, unknown>[], selectedTextColumn?: string) {
  const detected = chooseTextKey(rows);
  const textKey = selectedTextColumn || detected.key;
  return rows
    .map((row, index) => {
      const text = textKey ? String(row[textKey] ?? '') : pick(row, textKeys);
      const { aspect, subAspect } = inferAspectFromText(text);
      const sentiment = parseSentiment(pick(row, sentimentKeys), text, pick(row, scoreKeys));
      return {
        id: `u${index + 1}`,
        model: pick(row, modelKeys) || '上传车型',
        platform: pick(row, platformKeys) || '用户上传',
        date: pick(row, dateKeys) || '2026-06-02',
        aspect,
        subAspect,
        text,
        sentiment,
        score: sentiment === 'negative' ? -0.72 : sentiment === 'positive' ? 0.65 : -0.15,
      };
    })
    .filter((item) => item.text.trim().length > 0);
}

function buildImportResult(fileName: string, rows: Record<string, unknown>[], selectedTextColumn?: string): ReviewImportResult {
  const detected = chooseTextKey(rows);
  const textColumn = selectedTextColumn || detected.key;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return {
    fileName,
    rows,
    columns,
    reviews: parseReviewRows(rows, textColumn),
    detectedTextColumn: textColumn,
    needsColumnSelection: !selectedTextColumn && (!detected.key || !detected.confident),
  };
}

export async function parseReviewFile(file: File): Promise<ReviewImportResult> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.tsv') || lowerName.endsWith('.csv')) {
    const content = decodeText(await file.arrayBuffer());
    return buildImportResult(file.name, parseTextRows(content));
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const first = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first]);
  return buildImportResult(file.name, rows);
}

export function rebuildReviewImportResult(importResult: ReviewImportResult, selectedTextColumn: string): ReviewImportResult {
  return buildImportResult(importResult.fileName, importResult.rows, selectedTextColumn);
}
