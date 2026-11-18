import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { finished } from 'node:stream/promises';

const REQUEST_COUNT = 10;
const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT_MS = 30_000;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function parseUrl(input, base) {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Поддерживаются только HTTP и HTTPS.');
  }
  return url;
}

function getResponse(url) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, { headers: { 'Accept-Encoding': 'identity' } }, resolve);
    request.setTimeout(IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error('Сетевое соединение бездействовало 30 секунд.'));
    });
    request.on('error', reject);
  });
}

async function download(url) {
  for (let redirects = 0; ; redirects++) {
    const response = await getResponse(url);
    const { statusCode, headers } = response;

    if (REDIRECT_CODES.has(statusCode) && headers.location) {
      response.destroy();
      if (redirects === MAX_REDIRECTS) {
        throw new Error(`Превышен лимит перенаправлений (${MAX_REDIRECTS}).`);
      }
      url = parseUrl(headers.location, url);
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.destroy();
      throw new Error(`Сервер вернул HTTP ${statusCode}.`);
    }

    let bytes = 0;
    response.on('data', (chunk) => {
      bytes += chunk.length;
    });
    await finished(response, { cleanup: true });
    return bytes;
  }
}

async function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    console.log('Использование: node speedtest.mjs <http(s)://адрес>');
    return;
  }
  if (args.length !== 1) {
    throw new Error('Использование: node speedtest.mjs <http(s)://адрес>');
  }

  const url = parseUrl(args[0]);
  let totalBytes = 0;
  let totalTimeMs = 0;

  for (let attempt = 1; attempt <= REQUEST_COUNT; attempt++) {
    const startedAt = performance.now();
    try {
      totalBytes += await download(url);
    } catch (error) {
      throw new Error(`Запрос ${attempt}/${REQUEST_COUNT}: ${error.message}`);
    }
    totalTimeMs += performance.now() - startedAt;
  }

  console.log(`Среднее время запроса: ${(totalTimeMs / REQUEST_COUNT).toFixed(2)} мс`);
  console.log(`Общий объём: ${totalBytes} байт`);
  console.log(`Скорость скачивания: ${(totalBytes * 8 / (totalTimeMs * 1000)).toFixed(2)} Мбит/с`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
