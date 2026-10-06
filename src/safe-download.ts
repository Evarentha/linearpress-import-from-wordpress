/*
 * LinearPress Safe Download
 *
 * Implements the safe download module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) denied.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
denied.addSubnet('2001::',23,'ipv6'); denied.addSubnet('2001:db8::',32,'ipv6'); denied.addSubnet('2002::',16,'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied.check(address,'ipv4') : family === 6 && globalV6.check(address,'ipv6') && !denied.check(address,'ipv6');
}
export interface DownloadResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export interface DownloadDeps {
  resolve(host: string): Promise<Array<{address: string; family: number}>>;
  /** Transport MUST connect to the supplied IP, retaining URL hostname for Host/SNI/TLS. */
  fetch(url: URL, pinned: {address: string; family: number}, signal: AbortSignal): Promise<DownloadResponse>;
  maxBytes?: number;
  timeoutMs?: number;
}
const transport: DownloadDeps = {
  resolve: (host) => dns.lookup(host, {all: true, verbatim: true}),
  fetch: (url, pinned, signal) => new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      signal, agent: false,
      // No second DNS lookup: each actual connection is bound to the vetted address.
      lookup: ((_host: string, opts: any, cb: any) => opts?.all ? cb(null,[pinned]) : cb(null,pinned.address,pinned.family)) as any
    }, (response) => resolve({status: response.statusCode ?? 0, headers: response.headers, body: response, close: () => response.destroy()}));
    request.on('error', reject);
    request.end();
  })
};
/** HTTP(S), all DNS answers vetted, every redirect revalidated, fixed DNS connection,
 * single total deadline (including DNS/body), streamed byte cap even without Content-Length. */
export async function downloadPublic(url: string, deps: DownloadDeps = transport): Promise<{data: Buffer; mimeType: string}> {
  const controller = new AbortController();
  const max = deps.maxBytes ?? 256 * 1024 * 1024;
  const timer = setTimeout(() => controller.abort(new Error('附件下载超时')), deps.timeoutMs ?? 30_000);
  const deadline = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) return abort();
    controller.signal.addEventListener('abort', abort, {once:true});
    promise.then(resolve,reject).finally(() => controller.signal.removeEventListener('abort',abort));
  });
  let response: DownloadResponse | undefined;
  try {
    if (url.length > 8192) throw new Error('附件 URL 过长');
    let current = new URL(url);
    for (let hop=0; hop<=5; hop++) {
      if (!['http:','https:'].includes(current.protocol) || current.username || current.password) throw new Error('附件仅允许无凭据 HTTP(S) URL');
      const host = current.hostname.replace(/^\[|\]$/g,'');
      const addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await deadline(deps.resolve(host));
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error('禁止访问内网、保留或非公网地址');
      const pending = deps.fetch(current,addresses[0],controller.signal);
      pending.then((r) => { if (controller.signal.aborted) r.close(); }, () => undefined);
      response = await deadline(pending);
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.location;
        response.close(); response = undefined;
        if (typeof location !== 'string' || hop === 5) throw new Error('重定向无效或过多');
        current = new URL(location,current); continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      const length = response.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > max)) throw new Error('附件长度无效或过大');
      const chunks: Buffer[] = []; let size = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const chunk = await deadline(iterator.next());
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > max) throw new Error('附件流量超限');
        chunks.push(Buffer.from(chunk.value));
      }
      if (!size) throw new Error('空文件');
      return {data:Buffer.concat(chunks),mimeType:String(response.headers['content-type'] ?? '').split(';')[0].trim() || 'application/octet-stream'};
    }
    throw new Error('重定向过多');
  } finally { clearTimeout(timer); controller.abort(); response?.close(); }
}
