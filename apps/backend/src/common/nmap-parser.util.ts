import { DOMParser } from '@xmldom/xmldom';

export interface NmapPortRecord {
  ip: string;
  port: string;
  protocol: string;
  service: string;
  status: string;
}

/**
 * Parses an Nmap XML scan result (`nmap -oX`). Each <port> stays tied to
 * the <address> of its enclosing <host> so multiple hosts/ports never mix.
 */
export function parseNmapXml(xml: string): NmapPortRecord[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const hosts = Array.from(doc.getElementsByTagName('host'));
  const records: NmapPortRecord[] = [];

  for (const host of hosts) {
    const addresses = Array.from(host.getElementsByTagName('address'));
    const address = addresses.find((a) => a.getAttribute('addrtype') === 'ipv4') || addresses[0];
    const ip = address?.getAttribute('addr') || '';
    if (!ip) continue;

    const ports = Array.from(host.getElementsByTagName('port'));
    for (const port of ports) {
      const state = port.getElementsByTagName('state')[0];
      const service = port.getElementsByTagName('service')[0];
      records.push({
        ip,
        port: port.getAttribute('portid') || '',
        protocol: port.getAttribute('protocol') || '',
        service: service?.getAttribute('name') || '',
        status: state?.getAttribute('state') || '',
      });
    }
  }

  return records;
}

/**
 * Parses Nmap's plain-text scan output (`-oN`/`-oA`, i.e. .txt/.nmap files):
 *   Nmap scan report for host1.local (10.0.0.1)
 *   PORT     STATE  SERVICE
 *   22/tcp   open   ssh
 * Each port line attaches to the most recently seen "Nmap scan report for"
 * line, so ports never cross over to the wrong host.
 */
export function parseNmapText(text: string): NmapPortRecord[] {
  const records: NmapPortRecord[] = [];
  let currentIp = '';

  for (const line of text.split(/\r?\n/)) {
    const reportMatch = line.match(/^Nmap scan report for\s+(.+)$/);
    if (reportMatch) {
      const target = reportMatch[1].trim();
      const parenMatch = target.match(/\(([^)]+)\)\s*$/);
      currentIp = parenMatch ? parenMatch[1] : target;
      continue;
    }

    const portMatch = line.match(/^(\d+)\/(tcp|udp|sctp)\s+(\S+)\s+(\S+)/i);
    if (portMatch && currentIp) {
      records.push({
        ip: currentIp,
        port: portMatch[1],
        protocol: portMatch[2].toLowerCase(),
        status: portMatch[3].toLowerCase(),
        service: portMatch[4],
      });
    }
  }

  return records;
}

/** Sniffs actual content rather than trusting the file extension. */
export function parseNmapScan(content: string): NmapPortRecord[] {
  return content.includes('<nmaprun') ? parseNmapXml(content) : parseNmapText(content);
}
