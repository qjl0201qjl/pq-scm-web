import * as XLSX from 'xlsx';
import { ReviewRecord, Sentiment } from './types';

const textKeys = ['评论', '评论文本', '内容', 'text', 'comment'];
const modelKeys = ['车型', '车系', 'model', 'carModel'];
const platformKeys = ['平台', '来源', 'source', 'platform'];
const dateKeys = ['时间', '日期', 'date', 'created_at'];
const sentimentKeys = ['情感', '情感极性', 'label', 'sentiment'];

function pick(row: Record<string, unknown>, keys: string[]) {
  const matched = Object.keys(row).find((key) => keys.some((candidate) => key.toLowerCase().includes(candidate.toLowerCase())));
  return matched ? String(row[matched] ?? '') : '';
}

function parseSentiment(value: string, text: string): Sentiment {
  const raw = value.trim().toLowerCase();
  if (['1', 'positive', '正面', '积极'].some((key) => raw.includes(key))) return 'positive';
  if (['0', '-1', 'negative', '负面', '消极'].some((key) => raw.includes(key))) return 'negative';
  if (['neutral', '中性'].some((key) => raw.includes(key))) return 'neutral';
  return /差|慢|卡|异响|衰减|缩水|投诉|误报|不满|掉电|不舒服/.test(text) ? 'negative' : 'neutral';
}

function inferAspect(text: string) {
  const rules: Array<[RegExp, string, string]> = [
    [/续航|掉电|电耗|热泵|BMS|电池|低温|缩水/, '续航与能耗', '续航/热管理'],
    [/车机|座舱|语音|HUD|屏|卡顿|黑屏|SoC/, '智能座舱', '座舱交互体验'],
    [/智驾|雷达|辅助驾驶|误报|制动/, '智能驾驶', '感知与控制'],
    [/悬架|底盘|异响|噪声|NVH|座椅/, '舒适性与NVH', '舒适性问题'],
    [/充电|快充|限流/, '充电体验', '充电效率'],
    [/空间|风噪|密封/, '空间表现', '空间与密封'],
  ];
  return rules.find(([rule]) => rule.test(text)) || [/.*/, '综合体验', '综合评价'];
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

function rowsToReviews(rows: Record<string, unknown>[]) {
  return rows
    .map((row, index) => {
      const text = pick(row, textKeys) || Object.values(row).map(String).join(' ');
      const [, aspect, subAspect] = inferAspect(text);
      const sentiment = parseSentiment(pick(row, sentimentKeys), text);
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
    const content = await file.text();
    return rowsToReviews(parseTextRows(content));
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const first = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first]);
  return rowsToReviews(rows);
}
