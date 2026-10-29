'use strict';
'require baseclass';

/*
 * Nikki Studio - pure helpers (no DOM / rpc), shared by views and node tests.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

var BUILTIN_POLICIES = [ 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE' ];

var RULE_TYPES = [
	'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX', 'GEOSITE',
	'IP-CIDR', 'IP-CIDR6', 'IP-SUFFIX', 'IP-ASN', 'GEOIP',
	'SRC-GEOIP', 'SRC-IP-ASN', 'SRC-IP-CIDR', 'SRC-IP-SUFFIX',
	'DST-PORT', 'SRC-PORT', 'IN-PORT', 'IN-TYPE', 'IN-USER', 'IN-NAME',
	'PROCESS-PATH', 'PROCESS-PATH-REGEX', 'PROCESS-NAME', 'PROCESS-NAME-REGEX', 'UID',
	'NETWORK', 'DSCP', 'RULE-SET', 'AND', 'OR', 'NOT', 'SUB-RULE', 'MATCH'
];

var RULE_TYPE_DESC = {
	'DOMAIN': '完整域名', 'DOMAIN-SUFFIX': '域名后缀', 'DOMAIN-KEYWORD': '域名关键字',
	'DOMAIN-WILDCARD': '域名通配符', 'DOMAIN-REGEX': '域名正则', 'GEOSITE': '域名分类（GeoSite）',
	'IP-CIDR': 'IPv4 网段', 'IP-CIDR6': 'IPv6 网段', 'IP-SUFFIX': 'IP 后缀', 'IP-ASN': 'IP 所属 ASN',
	'GEOIP': 'IP 国家/地区（GeoIP）', 'SRC-GEOIP': '来源 IP 国家/地区', 'SRC-IP-ASN': '来源 IP ASN',
	'SRC-IP-CIDR': '来源 IP 网段', 'SRC-IP-SUFFIX': '来源 IP 后缀', 'DST-PORT': '目标端口',
	'SRC-PORT': '来源端口', 'IN-PORT': '入站端口', 'IN-TYPE': '入站类型', 'IN-USER': '入站用户',
	'IN-NAME': '入站名称', 'PROCESS-PATH': '进程路径', 'PROCESS-PATH-REGEX': '进程路径正则',
	'PROCESS-NAME': '进程名', 'PROCESS-NAME-REGEX': '进程名正则', 'UID': '用户 ID',
	'NETWORK': '网络类型（tcp/udp）', 'DSCP': 'DSCP 标记', 'RULE-SET': '规则集', 'AND': '逻辑与',
	'OR': '逻辑或', 'NOT': '逻辑非', 'SUB-RULE': '子规则', 'MATCH': '兜底（匹配全部）'
};

var IP_RULES = { 'IP-CIDR': 1, 'IP-CIDR6': 1, 'IP-SUFFIX': 1, 'IP-ASN': 1, 'GEOIP': 1, 'RULE-SET': 1 };

/* ---------------------------------------------------------------- */
/* Rules                                                            */
/* ---------------------------------------------------------------- */

function splitTop(s) {
	var res = [], depth = 0, cur = '';
	for (var i = 0; i < s.length; i++) {
		var c = s.charAt(i);
		if (c == '(') depth++;
		else if (c == ')') depth--;
		if (c == ',' && depth == 0) { res.push(cur); cur = ''; }
		else cur += c;
	}
	res.push(cur);
	return res;
}

function parseRule(str) {
	if (typeof(str) != 'string')
		return { raw: String(str), type: '', payload: '', target: '', options: [], invalid: true };
	var parts = splitTop(str).map(function(p) { return p.trim(); });
	var type = (parts[0] || '').toUpperCase();
	var r = { raw: str, type: type, payload: '', target: '', options: [], invalid: false };
	if (type == 'MATCH') {
		r.target = parts[1] || '';
		r.options = parts.slice(2);
		if (!r.target) r.invalid = true;
	}
	else {
		r.payload = parts[1] || '';
		r.target = parts[2] || '';
		r.options = parts.slice(3);
		if (parts.length < 3 || !r.payload || !r.target) r.invalid = true;
	}
	if (RULE_TYPES.indexOf(type) < 0) r.unknownType = true;
	return r;
}

function formatRule(r) {
	var parts = [ r.type ];
	if (r.type != 'MATCH') parts.push(r.payload);
	parts.push(r.target);
	(r.options || []).forEach(function(o) { if (o) parts.push(o); });
	return parts.join(',');
}

/* Batch import: accepts plain lines, "- RULE" YAML list items, quoted values, comments. */
function parseRuleLines(text) {
	var out = [], bad = [];
	String(text || '').split(/\r?\n/).forEach(function(line) {
		var l = line.trim();
		if (!l || l.charAt(0) == '#' || /^rules\s*:/.test(l) || /^payload\s*:/.test(l)) return;
		l = l.replace(/^-\s*/, '').replace(/\s+#.*$/, '');
		if ((l.charAt(0) == '"' && l.charAt(l.length - 1) == '"') || (l.charAt(0) == "'" && l.charAt(l.length - 1) == "'"))
			l = l.substring(1, l.length - 1);
		var r = parseRule(l);
		if (r.invalid) bad.push(line); else out.push(formatRule(r));
	});
	return { rules: out, bad: bad };
}

/* ---------------------------------------------------------------- */
/* Local rule tester (best effort)                                  */
/* ---------------------------------------------------------------- */

function ipv4ToInt(ip) {
	var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
	if (!m) return null;
	var n = 0;
	for (var i = 1; i <= 4; i++) {
		var v = +m[i];
		if (v > 255) return null;
		n = n * 256 + v;
	}
	return n;
}

function cidr4Match(ip, cidr) {
	var p = cidr.split('/');
	var a = ipv4ToInt(ip), b = ipv4ToInt(p[0]);
	if (a == null || b == null) return false;
	var bits = p.length > 1 ? +p[1] : 32;
	if (!(bits >= 0 && bits <= 32)) return false;
	var size = Math.pow(2, 32 - bits);
	return Math.floor(a / size) == Math.floor(b / size);
}

function wildcardToRegex(p) {
	var s = '^';
	for (var i = 0; i < p.length; i++) {
		var c = p.charAt(i);
		if (c == '*') s += '[^.]*';
		else if (c == '?') s += '.';
		else s += c.replace(/[.+^${}()|[\]\\\/]/g, '\\$&');
	}
	return new RegExp(s + '$', 'i');
}

function goRegex(re) {
	var flags = '';
	var m = /^\(\?([imsU]+)\)/.exec(re);
	if (m) {
		re = re.substring(m[0].length);
		if (m[1].indexOf('i') >= 0) flags += 'i';
		if (m[1].indexOf('s') >= 0) flags += 's';
		if (m[1].indexOf('m') >= 0) flags += 'm';
	}
	return new RegExp(re, flags);
}

/* returns 'yes' | 'no' | 'unknown' */
function ruleMatches(r, input) {
	var host = (input.host || '').toLowerCase(), ip = input.ip || '';
	var pl = (r.payload || '');
	switch (r.type) {
	case 'MATCH': return 'yes';
	case 'DOMAIN': return host && host == pl.toLowerCase() ? 'yes' : 'no';
	case 'DOMAIN-SUFFIX':
		if (!host) return 'no';
		pl = pl.toLowerCase().replace(/^\./, '');
		return (host == pl || host.slice(-(pl.length + 1)) == '.' + pl) ? 'yes' : 'no';
	case 'DOMAIN-KEYWORD': return host && host.indexOf(pl.toLowerCase()) >= 0 ? 'yes' : 'no';
	case 'DOMAIN-WILDCARD': return host && wildcardToRegex(pl).test(host) ? 'yes' : 'no';
	case 'DOMAIN-REGEX':
		try { return host && goRegex(pl).test(host) ? 'yes' : 'no'; } catch (e) { return 'unknown'; }
	case 'IP-CIDR':
		if (ip) return cidr4Match(ip, pl) ? 'yes' : 'no';
		return (host && r.options.indexOf('no-resolve') < 0) ? 'unknown' : 'no';
	case 'IP-CIDR6':
		if (ip && ip.indexOf(':') >= 0) return 'unknown';
		if (ip) return 'no';
		return (host && r.options.indexOf('no-resolve') < 0) ? 'unknown' : 'no';
	case 'GEOSITE':
		return host ? 'unknown' : 'no';
	case 'GEOIP': case 'IP-ASN': case 'IP-SUFFIX':
		if (ip) {
			if (r.type == 'GEOIP' && pl.toLowerCase() == 'private' && /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return 'yes';
			return 'unknown';
		}
		return (host && r.options.indexOf('no-resolve') < 0) ? 'unknown' : 'no';
	default:
		return 'unknown';
	}
}

function testRules(rules, query) {
	query = String(query || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[\/:?#].*$/, '');
	var input = ipv4ToInt(query) != null ? { ip: query } : { host: query };
	var maybes = [];
	for (var i = 0; i < rules.length; i++) {
		var r = parseRule(rules[i].rule || rules[i]);
		if (r.invalid) continue;
		var m = ruleMatches(r, input);
		if (m == 'yes') return { index: i, rule: r, maybes: maybes, origin: rules[i].origin };
		if (m == 'unknown' && maybes.length < 10) maybes.push({ index: i, rule: r, origin: rules[i].origin });
	}
	return { index: -1, rule: null, maybes: maybes };
}

/* ---------------------------------------------------------------- */
/* Group filters                                                    */
/* ---------------------------------------------------------------- */

function filterMatcher(filter) {
	if (!filter) return null;
	var res = String(filter).split('`').filter(function(x) { return x != ''; }).map(goRegex);
	return function(name) {
		for (var i = 0; i < res.length; i++) if (res[i].test(name)) return true;
		return false;
	};
}

/* Approximate mihomo group member resolution for preview. proxies: [{name,type}] */
function previewGroup(g, proxies) {
	var res = { members: [], error: null };
	try {
		var inc = filterMatcher(g.filter), exc = filterMatcher(g['exclude-filter']);
		var exTypes = String(g['exclude-type'] || '').split('|').map(function(x) { return x.trim().toLowerCase(); }).filter(function(x) { return x; });
		var pool = [];
		if (g['include-all'] || g['include-all-proxies'])
			pool = proxies.slice();
		(g.proxies || []).forEach(function(n) { if (!pool.some(function(p) { return p.name == n; })) pool.push({ name: n, explicit: true }); });
		res.members = pool.filter(function(p) {
			if (p.explicit && !(g['include-all'] || g['include-all-proxies'])) return true;
			if (inc && !inc(p.name)) return false;
			if (exc && exc(p.name)) return false;
			if (p.type && exTypes.indexOf(String(p.type).toLowerCase()) >= 0) return false;
			return true;
		}).map(function(p) { return p.name; });
	}
	catch (e) { res.error = String(e.message || e); }
	return res;
}

/* ---------------------------------------------------------------- */
/* Base64 / URL helpers                                             */
/* ---------------------------------------------------------------- */

function b64decode(s) {
	s = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
	while (s.length % 4) s += '=';
	var bin;
	if (typeof(atob) == 'function') bin = atob(s);
	else bin = Buffer.from(s, 'base64').toString('binary');
	try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
}

function isBase64Blob(s) {
	s = String(s || '').trim().replace(/\s+/g, '');
	return s.length >= 16 && /^[A-Za-z0-9+\/=_-]+$/.test(s) && !/:\/\//.test(s);
}

function dec(s) {
	try { return decodeURIComponent(String(s).replace(/\+/g, '%20')); } catch (e) { return s; }
}

function parseQuery(q) {
	var o = {};
	String(q || '').split('&').forEach(function(kv) {
		if (!kv) return;
		var i = kv.indexOf('=');
		var k = i < 0 ? kv : kv.substring(0, i), v = i < 0 ? '' : kv.substring(i + 1);
		o[dec(k)] = dec(v);
	});
	return o;
}

/* scheme://userinfo@host:port/path?query#fragment */
function splitUrl(link) {
	var m = /^([a-zA-Z0-9+.-]+):\/\/(.*)$/.exec(link);
	if (!m) return null;
	var rest = m[2], frag = '', query = '', path = '';
	var i = rest.indexOf('#');
	if (i >= 0) { frag = dec(rest.substring(i + 1)); rest = rest.substring(0, i); }
	i = rest.indexOf('?');
	if (i >= 0) { query = rest.substring(i + 1); rest = rest.substring(0, i); }
	i = rest.indexOf('/');
	if (i >= 0) { path = rest.substring(i); rest = rest.substring(0, i); }
	var user = '';
	i = rest.lastIndexOf('@');
	if (i >= 0) { user = rest.substring(0, i); rest = rest.substring(i + 1); }
	var host = rest, port = '';
	var h6 = /^\[([^\]]+)\](?::(.*))?$/.exec(rest);
	if (h6) { host = h6[1]; port = h6[2] || ''; }
	else {
		i = rest.lastIndexOf(':');
		if (i >= 0) { host = rest.substring(0, i); port = rest.substring(i + 1); }
	}
	return { scheme: m[1].toLowerCase(), user: user, host: host, port: port, path: path, query: parseQuery(query), name: frag };
}

function toPort(p) {
	var n = parseInt(p, 10);
	return (n > 0 && n < 65536) ? n : null;
}

function applyTransport(o, q, net) {
	net = (net || q.type || 'tcp').toLowerCase();
	if (net == 'ws' || net == 'websocket') {
		o.network = 'ws';
		var wo = {};
		if (q.path) wo.path = q.path;
		if (q.host) wo.headers = { Host: q.host };
		if (Object.keys(wo).length) o['ws-opts'] = wo;
	}
	else if (net == 'grpc') {
		o.network = 'grpc';
		if (q.serviceName || q.path) o['grpc-opts'] = { 'grpc-service-name': q.serviceName || q.path };
	}
	else if (net == 'h2' || net == 'http') {
		o.network = (net == 'h2') ? 'h2' : 'http';
		if (net == 'h2') {
			var ho = {};
			if (q.host) ho.host = [ q.host ];
			if (q.path) ho.path = q.path;
			o['h2-opts'] = ho;
		}
		else {
			var hp = {};
			if (q.path) hp.path = [ q.path ];
			if (q.host) hp.headers = { Host: [ q.host ] };
			o['http-opts'] = hp;
		}
	}
	else if (net == 'httpupgrade') {
		o.network = 'ws';
		var uo = { 'v2ray-http-upgrade': true };
		if (q.path) uo.path = q.path;
		if (q.host) uo.headers = { Host: q.host };
		o['ws-opts'] = uo;
	}
	else if (net == 'xhttp') {
		o.network = 'xhttp';
		var xo = {};
		if (q.path) xo.path = q.path;
		if (q.host) xo.host = q.host;
		if (q.mode) xo.mode = q.mode;
		o['xhttp-opts'] = xo;
	}
}

function applyTls(o, q, defaultTls) {
	var sec = (q.security || (defaultTls ? 'tls' : '')).toLowerCase();
	if (sec == 'tls' || sec == 'reality') {
		o.tls = true;
		var sni = q.sni || q.peer || q.host;
		if (sni) o.servername = sni;
		if (q.fp) o['client-fingerprint'] = q.fp;
		if (q.alpn) o.alpn = q.alpn.split(',');
		if (q.allowInsecure == '1' || q.insecure == '1' || q.allowInsecure == 'true') o['skip-cert-verify'] = true;
		if (sec == 'reality') {
			o['reality-opts'] = { 'public-key': q.pbk || '' };
			if (q.sid) o['reality-opts']['short-id'] = q.sid;
			if (!o['client-fingerprint']) o['client-fingerprint'] = 'chrome';
		}
	}
}

function parseShareLink(link) {
	link = String(link || '').trim();
	var u, o, q;
	var scheme = (/^([a-zA-Z0-9+.-]+):\/\//.exec(link) || [])[1];
	if (!scheme) throw new Error('无法识别的链接');
	scheme = scheme.toLowerCase();

	if (scheme == 'vmess') {
		var body = link.substring(8).replace(/#.*$/, '');
		var j;
		try { j = JSON.parse(b64decode(body)); } catch (e) { throw new Error('vmess 链接内容不是有效的 Base64 JSON'); }
		o = { name: j.ps || (j.add + ':' + j.port), type: 'vmess', server: j.add, port: toPort(j.port), uuid: j.id,
			alterId: parseInt(j.aid || 0, 10) || 0, cipher: j.scy || 'auto', udp: true };
		q = { path: j.path, host: j.host, serviceName: j.path, security: (j.tls == 'tls' || j.tls == 'reality') ? j.tls : '', sni: j.sni, fp: j.fp, alpn: j.alpn, pbk: j.pbk, sid: j.sid };
		applyTls(o, q, false);
		applyTransport(o, q, j.net);
		return o;
	}

	u = splitUrl(link);
	if (!u) throw new Error('无法识别的链接');
	q = u.query;

	switch (scheme) {
	case 'ss':
		var method, password, host = u.host, port = u.port;
		if (!u.user) {
			// legacy: ss://base64(method:password@host:port)#name
			var d = b64decode(link.substring(5).replace(/[#?].*$/, ''));
			var m1 = /^([^:]+):(.*)@([^@]+):(\d+)$/.exec(d);
			if (!m1) throw new Error('ss 链接格式无法识别');
			method = m1[1]; password = m1[2]; host = m1[3].replace(/^\[|\]$/g, ''); port = m1[4];
		}
		else {
			var ui = dec(u.user);
			if (ui.indexOf(':') < 0) ui = b64decode(u.user);
			var k = ui.indexOf(':');
			method = ui.substring(0, k); password = ui.substring(k + 1);
		}
		o = { name: u.name || (host + ':' + port), type: 'ss', server: host, port: toPort(port), cipher: method, password: password, udp: true };
		if (q.plugin) {
			var pp = q.plugin.split(';');
			var pname = pp[0];
			var popts = {};
			pp.slice(1).forEach(function(x) { var i = x.indexOf('='); popts[i < 0 ? x : x.substring(0, i)] = i < 0 ? true : x.substring(i + 1); });
			if (pname == 'obfs-local' || pname == 'simple-obfs') {
				o.plugin = 'obfs';
				o['plugin-opts'] = { mode: popts.obfs || 'http' };
				if (popts['obfs-host']) o['plugin-opts'].host = popts['obfs-host'];
			}
			else if (pname == 'v2ray-plugin') {
				o.plugin = 'v2ray-plugin';
				o['plugin-opts'] = { mode: popts.mode || 'websocket' };
				if (popts.tls) o['plugin-opts'].tls = true;
				if (popts.host) o['plugin-opts'].host = popts.host;
				if (popts.path) o['plugin-opts'].path = popts.path;
			}
			else if (pname == 'shadow-tls') {
				o.plugin = 'shadow-tls';
				o['plugin-opts'] = { host: popts.host || '', password: popts.password || '', version: +(popts.version || 3) };
			}
		}
		return o;

	case 'vless':
		o = { name: u.name || (u.host + ':' + u.port), type: 'vless', server: u.host, port: toPort(u.port), uuid: dec(u.user), udp: true };
		if (q.flow) o.flow = q.flow;
		if (q.encryption && q.encryption != 'none') o.encryption = q.encryption;
		applyTls(o, q, false);
		applyTransport(o, q, q.type);
		if (q.packetEncoding) o['packet-encoding'] = q.packetEncoding;
		return o;

	case 'trojan':
		o = { name: u.name || (u.host + ':' + u.port), type: 'trojan', server: u.host, port: toPort(u.port), password: dec(u.user), udp: true };
		if (!q.security) q.security = 'tls';
		applyTls(o, q, true);
		delete o.tls;
		if (q.sni || q.peer) o.sni = q.sni || q.peer;
		delete o.servername;
		applyTransport(o, q, q.type);
		return o;

	case 'hysteria2': case 'hy2':
		var p2 = u.port, ports = null;
		if (/[,-]/.test(p2)) { ports = p2; p2 = p2.split(/[,-]/)[0]; }
		o = { name: u.name || (u.host + ':' + p2), type: 'hysteria2', server: u.host, port: toPort(p2), password: dec(u.user), udp: true };
		if (q.mport) ports = q.mport;
		if (ports) o.ports = ports;
		if (q.sni) o.sni = q.sni;
		if (q.insecure == '1') o['skip-cert-verify'] = true;
		if (q.obfs && q.obfs != 'none') { o.obfs = q.obfs; if (q['obfs-password']) o['obfs-password'] = q['obfs-password']; }
		if (q.alpn) o.alpn = q.alpn.split(',');
		if (q.pinSHA256) o.fingerprint = q.pinSHA256;
		return o;

	case 'tuic':
		var tu = dec(u.user), ti = tu.indexOf(':');
		o = { name: u.name || (u.host + ':' + u.port), type: 'tuic', server: u.host, port: toPort(u.port),
			uuid: ti < 0 ? tu : tu.substring(0, ti), password: ti < 0 ? '' : tu.substring(ti + 1), udp: true };
		if (q.congestion_control) o['congestion-controller'] = q.congestion_control;
		if (q.udp_relay_mode) o['udp-relay-mode'] = q.udp_relay_mode;
		if (q.alpn) o.alpn = q.alpn.split(',');
		if (q.sni) o.sni = q.sni;
		if (q.allow_insecure == '1' || q.insecure == '1') o['skip-cert-verify'] = true;
		if (q.disable_sni == '1') o['disable-sni'] = true;
		return o;

	case 'anytls':
		o = { name: u.name || (u.host + ':' + u.port), type: 'anytls', server: u.host, port: toPort(u.port), password: dec(u.user), udp: true };
		if (q.sni) o.sni = q.sni;
		if (q.insecure == '1') o['skip-cert-verify'] = true;
		if (q.fp) o['client-fingerprint'] = q.fp;
		return o;

	case 'socks': case 'socks5': case 'http': case 'https':
		var cred = u.user ? dec(u.user) : '';
		if (cred && cred.indexOf(':') < 0) { try { cred = b64decode(u.user); } catch (e) {} }
		var ci = cred.indexOf(':');
		o = { name: u.name || (u.host + ':' + u.port), type: (scheme.indexOf('socks') == 0) ? 'socks5' : 'http', server: u.host, port: toPort(u.port) };
		if (cred) { o.username = ci < 0 ? cred : cred.substring(0, ci); o.password = ci < 0 ? '' : cred.substring(ci + 1); }
		if (scheme == 'https') o.tls = true;
		if (o.type == 'socks5') o.udp = true;
		return o;
	}
	throw new Error('暂不支持的协议：' + scheme);
}

function parseWireGuard(text, name) {
	var sec = '', iface = {}, peer = {};
	String(text).split(/\r?\n/).forEach(function(line) {
		var l = line.replace(/[#;].*$/, '').trim();
		if (!l) return;
		var m = /^\[(\w+)\]$/.exec(l);
		if (m) { sec = m[1].toLowerCase(); return; }
		var i = l.indexOf('=');
		if (i < 0) return;
		var k = l.substring(0, i).trim().toLowerCase(), v = l.substring(i + 1).trim();
		if (sec == 'interface') iface[k] = v;
		else if (sec == 'peer' && !peer.done) peer[k] = v;
	});
	if (!iface.privatekey || !peer.publickey || !peer.endpoint) throw new Error('WireGuard 配置缺少 PrivateKey / PublicKey / Endpoint');
	var ep = peer.endpoint, host, port;
	var e6 = /^\[([^\]]+)\]:(\d+)$/.exec(ep);
	if (e6) { host = e6[1]; port = e6[2]; }
	else { var j = ep.lastIndexOf(':'); host = ep.substring(0, j); port = ep.substring(j + 1); }
	var o = { name: name || ('WireGuard ' + host), type: 'wireguard', server: host, port: toPort(port),
		'private-key': iface.privatekey, 'public-key': peer.publickey, udp: true };
	(iface.address || '').split(',').map(function(x) { return x.trim(); }).forEach(function(a) {
		var ip = a.replace(/\/\d+$/, '');
		if (ip.indexOf(':') >= 0) { if (!o.ipv6) o.ipv6 = ip; }
		else if (ip && !o.ip) o.ip = ip;
	});
	if (peer.presharedkey) o['pre-shared-key'] = peer.presharedkey;
	if (iface.mtu) o.mtu = +iface.mtu;
	if (peer.allowedips) o['allowed-ips'] = peer.allowedips.split(',').map(function(x) { return x.trim(); });
	if (iface.dns) {
		o.dns = iface.dns.split(',').map(function(x) { return x.trim(); }).filter(function(x) { return /^[0-9a-fA-F:.]+$/.test(x); });
		if (o.dns.length) o['remote-dns-resolve'] = true; else delete o.dns;
	}
	if (peer.persistentkeepalive) o['persistent-keepalive'] = +peer.persistentkeepalive;
	return o;
}

/* Parse pasted import text. Returns { proxies: [], errors: [], yaml: bool } */
function parseImport(text) {
	var res = { proxies: [], errors: [], yaml: false };
	text = String(text || '').trim();
	if (!text) return res;
	if (/^\s*\[Interface\]/im.test(text) && /\[Peer\]/i.test(text)) {
		try { res.proxies.push(parseWireGuard(text)); } catch (e) { res.errors.push(e.message); }
		return res;
	}
	if (/(^|\n)\s*(proxies\s*:|-\s*\{?\s*name\s*:)/.test(text) || /^\s*\{?\s*name\s*:/.test(text)) {
		res.yaml = true;
		return res;
	}
	if (isBase64Blob(text)) {
		var d = b64decode(text);
		if (/:\/\//.test(d)) text = d;
	}
	text.split(/\r?\n/).forEach(function(l) {
		l = l.trim();
		if (!l || l.charAt(0) == '#') return;
		try { res.proxies.push(parseShareLink(l)); }
		catch (e) { res.errors.push((l.length > 60 ? l.substring(0, 60) + '…' : l) + '：' + e.message); }
	});
	return res;
}

/* ---------------------------------------------------------------- */
/* Minimal YAML emitter (for display / editing of small objects)    */
/* ---------------------------------------------------------------- */

var YAML_RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

function yamlScalar(v) {
	if (v === null || v === undefined) return 'null';
	if (typeof(v) == 'boolean' || typeof(v) == 'number') return String(v);
	var s = String(v);
	if (s === '' || YAML_RESERVED.test(s) || /^[-+]?(\d|\.\d)/.test(s) || /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
	    /:\s|\s#|\s$|:$|[\x00-\x1f]/.test(s) || /^0x/i.test(s) || /^\.(inf|nan)$/i.test(s))
		return JSON.stringify(s);
	return s;
}

function yamlKey(k) {
	return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(k) && !YAML_RESERVED.test(k) ? k : JSON.stringify(k);
}

function dumpYaml(v, indent) {
	indent = indent || '';
	var out = [];
	if (Array.isArray(v)) {
		if (!v.length) return '[]';
		v.forEach(function(x) {
			if (x !== null && typeof(x) == 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length)) {
				var sub = dumpYaml(x, indent + '  ');
				out.push(indent + '- ' + sub.substring(indent.length + 2));
			}
			else out.push(indent + '- ' + (x !== null && typeof(x) == 'object' ? (Array.isArray(x) ? '[]' : '{}') : yamlScalar(x)));
		});
		return out.join('\n');
	}
	if (v !== null && typeof(v) == 'object') {
		var keys = Object.keys(v);
		if (!keys.length) return '{}';
		keys.forEach(function(k) {
			var x = v[k];
			if (x !== null && typeof(x) == 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length))
				out.push(indent + yamlKey(k) + ':\n' + dumpYaml(x, indent + '  '));
			else
				out.push(indent + yamlKey(k) + ': ' + (x !== null && typeof(x) == 'object' ? (Array.isArray(x) ? '[]' : '{}') : yamlScalar(x)));
		});
		return out.join('\n');
	}
	return indent + yamlScalar(v);
}

/* ---------------------------------------------------------------- */
/* Line diff (Myers)                                                */
/* ---------------------------------------------------------------- */

function diffLines(a, b) {
	var A = a === '' ? [] : String(a).replace(/\n$/, '').split('\n');
	var B = b === '' ? [] : String(b).replace(/\n$/, '').split('\n');
	var pre = 0;
	while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
	var suf = 0;
	while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
	var a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
	var N = a2.length, M = b2.length, MAX = N + M;
	var ops = [];
	if (MAX > 0) {
		if (N * M > 25000000 || MAX > 40000) {
			a2.forEach(function(l) { ops.push([ '-', l ]); });
			b2.forEach(function(l) { ops.push([ '+', l ]); });
		}
		else {
			var V = { 1: 0 }, trace = [], D, k, x, y, found = false;
			for (D = 0; D <= MAX && !found; D++) {
				trace.push(Object.assign({}, V));
				for (k = -D; k <= D; k += 2) {
					if (k == -D || (k != D && V[k - 1] < V[k + 1])) x = V[k + 1];
					else x = V[k - 1] + 1;
					y = x - k;
					while (x < N && y < M && a2[x] === b2[y]) { x++; y++; }
					V[k] = x;
					if (x >= N && y >= M) { found = true; break; }
				}
			}
			x = N; y = M;
			var rev = [];
			for (D = trace.length - 1; D >= 0; D--) {
				var Vd = trace[D];
				k = x - y;
				var pk;
				if (k == -D || (k != D && Vd[k - 1] < Vd[k + 1])) pk = k + 1; else pk = k - 1;
				var px = Vd[pk], py = px - pk;
				while (x > px && y > py) { rev.push([ ' ', a2[x - 1] ]); x--; y--; }
				if (D > 0) {
					if (x == px) rev.push([ '+', b2[y - 1] ]);
					else rev.push([ '-', a2[x - 1] ]);
				}
				x = px; y = py;
			}
			ops = rev.reverse();
		}
	}
	var all = [];
	A.slice(0, pre).forEach(function(l) { all.push([ ' ', l ]); });
	all = all.concat(ops);
	A.slice(A.length - suf).forEach(function(l) { all.push([ ' ', l ]); });
	return all;
}

/* Collapse unchanged runs into hunks with `ctx` lines of context. */
function diffHunks(ops, ctx) {
	ctx = ctx == null ? 3 : ctx;
	var keep = new Array(ops.length).fill(false), changed = 0;
	ops.forEach(function(o, i) {
		if (o[0] != ' ') {
			changed++;
			for (var j = Math.max(0, i - ctx); j <= Math.min(ops.length - 1, i + ctx); j++) keep[j] = true;
		}
	});
	var out = [], skipped = 0;
	ops.forEach(function(o, i) {
		if (keep[i]) {
			if (skipped) { out.push([ '@', '… 省略 ' + skipped + ' 行未改动 …' ]); skipped = 0; }
			out.push(o);
		}
		else skipped++;
	});
	if (skipped && out.length) out.push([ '@', '… 省略 ' + skipped + ' 行未改动 …' ]);
	return { lines: out, changed: changed };
}

/* ---------------------------------------------------------------- */
/* Misc                                                             */
/* ---------------------------------------------------------------- */

function encodeName(s) {
	return encodeURIComponent(s).replace(/[!'()*]/g, function(c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}

function uniqueName(name, taken) {
	if (!taken[name]) return name;
	for (var i = 2; ; i++) if (!taken[name + ' ' + i]) return name + ' ' + i;
}

function clone(v) {
	return v == null ? v : JSON.parse(JSON.stringify(v));
}

/* Rename a policy name inside groups (proxies lists) and rules (target). */
function renameInGroups(groups, from, to) {
	var n = 0;
	(groups || []).forEach(function(g) {
		if (Array.isArray(g.proxies)) g.proxies = g.proxies.map(function(x) { if (x === from) { n++; return to; } return x; });
	});
	return n;
}

function renameInRules(rules, from, to) {
	var n = 0;
	for (var i = 0; i < (rules || []).length; i++) {
		var r = parseRule(rules[i]);
		if (!r.invalid && r.target === from) { r.target = to; rules[i] = formatRule(r); n++; }
	}
	return n;
}

function referencesTo(name, groups, rules) {
	var refs = { groups: [], rules: 0 };
	(groups || []).forEach(function(g) { if ((g.proxies || []).indexOf(name) >= 0) refs.groups.push(g.name); });
	(rules || []).forEach(function(s) { var r = parseRule(s); if (!r.invalid && r.target === name) refs.rules++; });
	return refs;
}

return baseclass.extend({
	BUILTIN_POLICIES: BUILTIN_POLICIES,
	RULE_TYPES: RULE_TYPES,
	RULE_TYPE_DESC: RULE_TYPE_DESC,
	IP_RULES: IP_RULES,
	splitTop: splitTop,
	parseRule: parseRule,
	formatRule: formatRule,
	parseRuleLines: parseRuleLines,
	testRules: testRules,
	goRegex: goRegex,
	filterMatcher: filterMatcher,
	previewGroup: previewGroup,
	b64decode: b64decode,
	parseShareLink: parseShareLink,
	parseWireGuard: parseWireGuard,
	parseImport: parseImport,
	yamlScalar: yamlScalar,
	dumpYaml: dumpYaml,
	diffLines: diffLines,
	diffHunks: diffHunks,
	encodeName: encodeName,
	uniqueName: uniqueName,
	clone: clone,
	renameInGroups: renameInGroups,
	renameInRules: renameInRules,
	referencesTo: referencesTo
});
