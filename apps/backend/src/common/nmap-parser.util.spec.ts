import { parseNmapXml, parseNmapText, parseNmapScan } from './nmap-parser.util';

const SAMPLE_XML = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open"/>
        <service name="ssh"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="closed"/>
        <service name="http"/>
      </port>
    </ports>
  </host>
  <host>
    <address addr="10.0.0.2" addrtype="ipv4"/>
    <ports>
      <port protocol="udp" portid="53">
        <state state="open"/>
        <service name="domain"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

describe('parseNmapXml', () => {
  it('extracts one record per port, keyed to its own host', () => {
    const records = parseNmapXml(SAMPLE_XML);
    expect(records).toEqual([
      { ip: '10.0.0.1', port: '22', protocol: 'tcp', service: 'ssh', status: 'open' },
      { ip: '10.0.0.1', port: '80', protocol: 'tcp', service: 'http', status: 'closed' },
      { ip: '10.0.0.2', port: '53', protocol: 'udp', service: 'domain', status: 'open' },
    ]);
  });

  it('never mixes ports from different hosts', () => {
    const records = parseNmapXml(SAMPLE_XML);
    const host1Ports = records.filter((r) => r.ip === '10.0.0.1');
    const host2Ports = records.filter((r) => r.ip === '10.0.0.2');
    expect(host1Ports).toHaveLength(2);
    expect(host2Ports).toHaveLength(1);
  });

  it('returns an empty array for a scan with no hosts', () => {
    expect(parseNmapXml('<nmaprun></nmaprun>')).toEqual([]);
  });
});

const SAMPLE_TEXT = `Starting Nmap 7.94 ( https://nmap.org ) at 2026-09-18 10:00 UTC
Nmap scan report for host1.local (10.0.0.1)
Host is up (0.0010s latency).
PORT     STATE    SERVICE
22/tcp   open     ssh
80/tcp   closed   http

Nmap scan report for 10.0.0.2
Host is up (0.0020s latency).
PORT     STATE    SERVICE
53/udp   open     domain

Nmap done: 2 IP addresses (2 hosts up) scanned in 1.00 seconds
`;

describe('parseNmapText', () => {
  it('extracts one record per port, keyed to its own host', () => {
    expect(parseNmapText(SAMPLE_TEXT)).toEqual([
      { ip: '10.0.0.1', port: '22', protocol: 'tcp', service: 'ssh', status: 'open' },
      { ip: '10.0.0.1', port: '80', protocol: 'tcp', service: 'http', status: 'closed' },
      { ip: '10.0.0.2', port: '53', protocol: 'udp', service: 'domain', status: 'open' },
    ]);
  });

  it('handles a target with no hostname', () => {
    const records = parseNmapText(SAMPLE_TEXT);
    expect(records.filter((r) => r.ip === '10.0.0.2')).toHaveLength(1);
  });
});

describe('parseNmapScan', () => {
  it('routes XML content to the XML parser', () => {
    expect(parseNmapScan(SAMPLE_XML)).toHaveLength(3);
  });

  it('routes plain-text content to the text parser', () => {
    expect(parseNmapScan(SAMPLE_TEXT)).toHaveLength(3);
  });
});
