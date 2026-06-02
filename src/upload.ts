import * as XLSX from 'xlsx';
import { inferAspectFromText, inferSentimentFromText } from './absa';
import { ReviewRecord, Sentiment } from './types';

const textKeys = ['评论', '评论文本', '评论内容', '内容', 'text', 'comment', 'comment_text', 'review'];
const modelKeys = ['车型', '车系', 'series_name', 'model', 'carModel'];
const platformKeys = ['平台', '来源', 'source', 'platform'];
const dateKeys = ['时间', '日期', 'date', 'created_at', 'pub_time', 'time'];
const sentimentKeys = ['情感', '情感极性', 'label', 'sentiment'];
const scoreKeys = ['评分', 'score', 'user_score', 'comment_score', 'star'];
const ignoredTextKeys = ['index', 'id', 'comment_id', 'label', 'score', 'user_score', 'comment_score', 'pub_time', 'date', 'price', 'price_range'];
const qualityKeywordPattern = /续航|油耗|电耗|操控|动力|车机|座舱|中控|空间|内饰|外观|悬架|悬挂|减震|底盘|充电|智驾|雷达|售后|配置|舒适|噪声|异响|性价比|刹车|制动|座椅|空调|发动机/;
const mojibakePattern = /[åæçèéäöüÂÃ¤¦§¨©«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]|�/;

function decodeText(buffer: ArrayBuffer) {
  const decoders = ['utf-8', 'gb18030', 'gbk'];
  const decoded = decoders.map((encoding) => {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
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
  const keyBonus = textKeys.some((candidate) => normalizedKey.includes(normalizeKey(candidate))) ? 500 : 0;
  const sample = values.slice(0, 80).join('');
  const chineseCount = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
  const keywordCount = (sample.match(qualityKeywordPattern) || []).length;
  const digitCount = (sample.match(/\d/g) || []).length;
  const avgLength = values.length ? values.slice(0, 80).reduce((sum, item) => sum + item.length, 0) / Math.min(values.length, 80) : 0;
  return keyBonus + chineseCount * 2 + keywordCount * 30 + avgLength * 3 - digitCount * 0.4;
}

function chooseTextKey(rows: Record<string, unknown>[]) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const direct = keys.find((key) => textKeys.some((candidate) => normalizeKey(key).includes(normalizeKey(candidate))));
  if (direct) return direct;
  return keys
    .map((key) => ({ key, score: textColumnScore(key, rows.map((row) => String(row[key] ?? ''))) }))
    .sort((a, b) => b.score - a.score)[0]?.key;
}

function rowsToReviews(rows: Record<string, unknown>[]) {
  const textKey = chooseTextKey(rows);
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

export async function parseReviewFile(file: File): Promise<ReviewRecord[]> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.tsv') || lowerName.endsWith('.csv')) {
    const content = decodeText(await file.arrayBuffer());
    return rowsToReviews(parseTextRows(content));
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const first = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first]);
  return rowsToReviews(rows);
}
