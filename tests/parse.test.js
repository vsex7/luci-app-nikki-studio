const assert = require('assert');
const P = require('./load.js')(__dirname + '/../htdocs/luci-static/resources/tools/nikkistudio_parse.js');
let n = 0;
function t(name, fn) { fn(); n++; }

t('rule parse/format', () => {
	const r = P.parseRule('DOMAIN-SUFFIX,google.com,🚀 节点选择');
	assert.deepStrictEqual([r.type, r.payload, r.target, r.invalid], ['DOMAIN-SUFFIX', 'google.com', '🚀 节点选择', false]);
	assert.strictEqual(P.formatRule(P.parseRule('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve')), 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve');
	const l = P.parseRule('AND,((DOMAIN,a.com),(NETWORK,UDP)),REJECT');
	assert.strictEqual(l.payload, '((DOMAIN,a.com),(NETWORK,UDP))'); assert.strictEqual(l.target, 'REJECT');
	assert.strictEqual(P.parseRule('MATCH,DIRECT').target, 'DIRECT');
	assert.ok(P.parseRule('DOMAIN,x').invalid);
});
t('batch import', () => {
	const r = P.parseRuleLines("rules:\n  - DOMAIN,a.com,DIRECT\n  - 'GEOIP,CN,DIRECT,no-resolve'  # c\n# x\nbad line\n");
	assert.deepStrictEqual(r.rules, ['DOMAIN,a.com,DIRECT', 'GEOIP,CN,DIRECT,no-resolve']);
	assert.strictEqual(r.bad.length, 1);
});
t('tester', () => {
	const rules = ['DOMAIN-KEYWORD,ads,REJECT', 'GEOSITE,cn,DIRECT', 'DOMAIN-SUFFIX,google.com,P', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve', 'MATCH,F'];
	let x = P.testRules(rules, 'https://www.google.com/abc');
	assert.strictEqual(x.index, 2); assert.strictEqual(x.maybes.length, 1);
	assert.strictEqual(P.testRules(rules, '192.168.1.5').index, 3);
	assert.strictEqual(P.testRules(rules, 'example.org').index, 4);
	assert.strictEqual(P.testRules(['DOMAIN-WILDCARD,*.a.com,X'], 'b.a.com').index, 0);
	assert.strictEqual(P.testRules(['DOMAIN-REGEX,(?i)^WWW\\.,X'], 'www.x.com').index, 0);
});
t('filter preview', () => {
	const px = [{name:'🇭🇰 香港 01', type:'ss'}, {name:'HK 02 IPLC', type:'vmess'}, {name:'🇯🇵 日本', type:'ss'}, {name:'剩余流量：10G', type:'ss'}];
	const g = P.previewGroup({ 'include-all': true, filter: '(?i)港|hk', 'exclude-type': 'vmess' }, px);
	assert.deepStrictEqual(g.members, ['🇭🇰 香港 01']);
	assert.deepStrictEqual(P.previewGroup({ 'include-all-proxies': true, 'exclude-filter': '剩余`日本' }, px).members, ['🇭🇰 香港 01', 'HK 02 IPLC']);
	assert.deepStrictEqual(P.previewGroup({ proxies: ['DIRECT', 'a'] }, px).members, ['DIRECT', 'a']);
});
t('share links', () => {
	let o = P.parseShareLink('ss://' + Buffer.from('aes-256-gcm:pa:ss').toString('base64') + '@1.2.3.4:8388#%F0%9F%87%AD%F0%9F%87%B0%20HK');
	assert.deepStrictEqual([o.type, o.server, o.port, o.cipher, o.password, o.name], ['ss', '1.2.3.4', 8388, 'aes-256-gcm', 'pa:ss', '🇭🇰 HK']);
	o = P.parseShareLink('ss://2022-blake3-aes-128-gcm:abc%3D@[2001:db8::1]:443?plugin=obfs-local%3Bobfs%3Dtls%3Bobfs-host%3Dx.com#n');
	assert.deepStrictEqual([o.server, o.cipher, o.password, o.plugin, o['plugin-opts'].mode], ['2001:db8::1', '2022-blake3-aes-128-gcm', 'abc=', 'obfs', 'tls']);
	o = P.parseShareLink('ss://' + Buffer.from('chacha20-ietf-poly1305:pw@h.com:1234').toString('base64') + '#legacy');
	assert.deepStrictEqual([o.server, o.port, o.password], ['h.com', 1234, 'pw']);
	o = P.parseShareLink('vless://uuid-1@a.com:443?security=reality&pbk=PK&sid=ab&sni=www.apple.com&fp=chrome&flow=xtls-rprx-vision&type=tcp#R');
	assert.deepStrictEqual([o.type, o.tls, o.servername, o['reality-opts']['public-key'], o['reality-opts']['short-id'], o.flow], ['vless', true, 'www.apple.com', 'PK', 'ab', 'xtls-rprx-vision']);
	o = P.parseShareLink('vless://u@a.com:443?security=tls&type=ws&path=%2Fws&host=cdn.com#W');
	assert.deepStrictEqual(o['ws-opts'], { path: '/ws', headers: { Host: 'cdn.com' } });
	o = P.parseShareLink('vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: '美国', add: 'v.com', port: '443', id: 'id', aid: '0', net: 'grpc', path: 'svc', tls: 'tls', sni: 's.com' })).toString('base64'));
	assert.deepStrictEqual([o.name, o.network, o['grpc-opts']['grpc-service-name'], o.servername], ['美国', 'grpc', 'svc', 's.com']);
	o = P.parseShareLink('trojan://pw@t.com:443?sni=x.com&allowInsecure=1#T');
	assert.deepStrictEqual([o.sni, o['skip-cert-verify'], o.tls], ['x.com', true, undefined]);
	o = P.parseShareLink('hy2://pw@h.com:443?mport=20000-30000&sni=h.com&obfs=salamander&obfs-password=o#H');
	assert.deepStrictEqual([o.type, o.ports, o.obfs, o['obfs-password']], ['hysteria2', '20000-30000', 'salamander', 'o']);
	o = P.parseShareLink('hysteria2://pw@h.com:443,5000-6000/?insecure=1#H');
	assert.deepStrictEqual([o.port, o.ports, o['skip-cert-verify']], [443, '443,5000-6000', true]);
	o = P.parseShareLink('tuic://uu:pp@t.com:443?congestion_control=bbr&alpn=h3#T');
	assert.deepStrictEqual([o.uuid, o.password, o['congestion-controller'], o.alpn], ['uu', 'pp', 'bbr', ['h3']]);
	o = P.parseShareLink('socks5://u:p@1.1.1.1:1080#S');
	assert.deepStrictEqual([o.type, o.username, o.password], ['socks5', 'u', 'p']);
	assert.throws(() => P.parseShareLink('foo://x'));
});
t('wireguard + import', () => {
	const conf = '[Interface]\nPrivateKey = PRIV\nAddress = 10.0.0.2/32, fd00::2/128\nDNS = 1.1.1.1\nMTU = 1280\n\n[Peer]\nPublicKey = PUB\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = wg.com:51820\n';
	const r = P.parseImport(conf);
	assert.deepStrictEqual([r.proxies[0].ip, r.proxies[0].ipv6, r.proxies[0].port, r.proxies[0].mtu, r.proxies[0].dns], ['10.0.0.2', 'fd00::2', 51820, 1280, ['1.1.1.1']]);
	const blob = Buffer.from('trojan://a@b.com:443#1\nvless://u@c.com:443#2\n').toString('base64');
	assert.strictEqual(P.parseImport(blob).proxies.length, 2);
	assert.ok(P.parseImport('proxies:\n  - name: a\n    type: ss').yaml);
	const e = P.parseImport('trojan://a@b.com:443#1\nxx://1');
	assert.deepStrictEqual([e.proxies.length, e.errors.length], [1, 1]);
});
t('yaml dump', () => {
	const y = P.dumpYaml({ name: '🇭🇰 HK', port: 443, 'ws-opts': { path: '/ws', headers: { Host: 'a.com' } }, alpn: ['h2', 'http/1.1'], x: 'yes', y: '123', z: 'a: b', e: [], o: {} , list: [{a: 1, b: [1]}]});
	assert.strictEqual(y, 'name: 🇭🇰 HK\nport: 443\nws-opts:\n  path: /ws\n  headers:\n    Host: a.com\nalpn:\n  - h2\n  - http/1.1\nx: "yes"\n"y": "123"\nz: "a: b"\ne: []\no: {}\nlist:\n  - a: 1\n    b:\n      - 1');
});
t('diff', () => {
	const ops = P.diffLines('a\nb\nc\nd\n', 'a\nx\nc\nd\ne\n');
	assert.deepStrictEqual(ops, [[' ', 'a'], ['-', 'b'], ['+', 'x'], [' ', 'c'], [' ', 'd'], ['+', 'e']]);
	assert.deepStrictEqual(P.diffLines('', 'a\n'), [['+', 'a']]);
	assert.deepStrictEqual(P.diffLines('a\n', ''), [['-', 'a']]);
	// random consistency check
	for (let it = 0; it < 200; it++) {
		const rnd = () => Array.from({ length: Math.floor(Math.random() * 15) }, () => 'abcd'[Math.floor(Math.random() * 4)]).join('\n');
		const a = rnd(), b = rnd();
		const o = P.diffLines(a, b);
		assert.strictEqual(o.filter(x => x[0] != '+').map(x => x[1]).join('\n'), a === '' ? '' : a);
		assert.strictEqual(o.filter(x => x[0] != '-').map(x => x[1]).join('\n'), b === '' ? '' : b);
	}
	const h = P.diffHunks(P.diffLines('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n', '1\n2\n3\n4\n5\nX\n7\n8\n9\n10\n'), 1);
	assert.strictEqual(h.changed, 2); assert.strictEqual(h.lines[0][0], '@');
});
t('rename/refs/encode', () => {
	const g = [{ name: 'G', proxies: ['A', 'B'] }], r = ['MATCH,A', 'DOMAIN,x,B'];
	assert.strictEqual(P.renameInGroups(g, 'A', 'A2'), 1); assert.strictEqual(P.renameInRules(r, 'A', 'A2'), 1);
	assert.deepStrictEqual(r, ['MATCH,A2', 'DOMAIN,x,B']);
	assert.deepStrictEqual(P.referencesTo('B', g, r), { groups: ['G'], rules: 1 });
	assert.ok(/^[A-Za-z0-9%._~-]+$/.test(P.encodeName("🚀 节点(1)!'*")));
	assert.strictEqual(P.uniqueName('a', { a: 1, 'a 2': 1 }), 'a 3');
});
console.log('parse tests passed: ' + n);
