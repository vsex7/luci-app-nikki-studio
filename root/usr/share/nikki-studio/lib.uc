// Nikki Studio - shared backend library
// Copyright (C) 2026 Nikki Studio contributors
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

import { access, popen, readfile, writefile, mkdir, unlink, lsdir, rename, stat, chmod, rmdir } from 'fs';
import { cursor } from 'uci';

export const HOME = '/etc/nikki';
export const PROFILES_DIR = HOME + '/profiles';
export const SUBSCRIPTIONS_DIR = HOME + '/subscriptions';
export const MIXIN_FILE = HOME + '/mixin.yaml';
export const MIXIN_UC = HOME + '/ucode/mixin.uc';
export const RUN_DIR = HOME + '/run';
export const RUN_PROFILE = RUN_DIR + '/config.yaml';
export const APP_LOG = '/var/log/nikki/app.log';
export const CORE_LOG = '/var/log/nikki/core.log';
export const INIT_SCRIPT = '/etc/init.d/nikki';

export const STUDIO_DIR = '/etc/nikki-studio';
export const BACKUP_DIR = STUDIO_DIR + '/backups';
export const RUNTIME_DIR = '/var/run/nikki-studio';
export const JOBS_DIR = RUNTIME_DIR + '/jobs';
export const LOCK_DIR = RUNTIME_DIR + '/lock';

export const MAX_BACKUPS = 30;
export const KEEP_JOBS = 3;
export const LOCK_STALE = 300;

// Nikki merge pipeline (copied verbatim from /etc/init.d/nikki, Nikki 2026.10.10)
export const MERGE_CORE = '.proxies = .nikki-proxies + .proxies | del(.nikki-proxies) | .proxy-groups = .nikki-proxy-groups + .proxy-groups | del(.nikki-proxy-groups) | .rules = .nikki-rules + .rules | del(.nikki-rules) | explode(.)';
export const MERGE_EXPR = '... comments="" | . as $item ireduce ({}; . * $item ) | ' + MERGE_CORE;

export const MIXIN_SECTIONS = [ 'proxies', 'nikki-proxies', 'proxy-groups', 'nikki-proxy-groups', 'rules', 'nikki-rules', 'rule-providers' ];
export const PROFILE_SECTIONS = [ 'proxies', 'proxy-groups', 'rules', 'rule-providers' ];
export const MAP_SECTIONS = { 'rule-providers': true };

// UCI overwrite switches -> yq delete expression (see /etc/init.d/nikki)
export const OVERWRITES = [
	[ 'authentication', 'del(.authentication)' ],
	[ 'tun_dns_hijack', 'del(.tun.dns-hijack)' ],
	[ 'fake_ip_filter', 'del(.dns.fake-ip-filter)' ],
	[ 'hosts', 'del(.hosts)' ],
	[ 'dns_nameserver', 'del(.dns.default-nameserver) | del(.dns.proxy-server-nameserver) | del(.dns.direct-nameserver) | del(.dns.nameserver) | del(.dns.fallback)' ],
	[ 'dns_nameserver_policy', 'del(.dns.nameserver-policy)' ],
	[ 'sniffer_force_domain_name', 'del(.sniffer.force-domain)' ],
	[ 'sniffer_ignore_domain_name', 'del(.sniffer.skip-domain)' ],
	[ 'sniffer_sniff', 'del(.sniffer.sniff)' ],
];

export const BUILTIN_POLICIES = [ 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL' ];

/* ------------------------------------------------------------------ */
/* generic helpers                                                     */
/* ------------------------------------------------------------------ */

export function getpid() {
	const s = readfile('/proc/self/stat');
	return s ? +split(s, ' ')[0] : 0;
};

export function mkdirp(path) {
	const parts = split(path, '/');
	let cur = '';
	for (let p in parts) {
		if (p == '')
			continue;
		cur += '/' + p;
		if (!access(cur))
			mkdir(cur, 0755);
	}
	return access(path);
};

export function ensure_runtime() {
	if (!access(JOBS_DIR))
		mkdirp(JOBS_DIR);
};

export function shq(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
};

// Run a shell command. stdout is returned in `out`, stderr in `err`.
export function run(cmd) {
	ensure_runtime();
	const errfile = sprintf('%s/.stderr.%d', RUNTIME_DIR, getpid());
	const p = popen('( ' + cmd + ' ) 2>' + shq(errfile));
	if (!p) {
		return { code: -1, out: '', err: 'popen failed' };
	}
	const out = p.read('all') ?? '';
	const code = p.close();
	const err = readfile(errfile) ?? '';
	unlink(errfile);
	return { code: code, out: out, err: err };
};


export function now() {
	return time();
};

export function timestamp() {
	const t = localtime();
	return sprintf('%04d%02d%02d-%02d%02d%02d', t.year, t.mon, t.mday, t.hour, t.min, t.sec);
};

export function uuid() {
	const u = readfile('/proc/sys/kernel/random/uuid');
	return u ? trim(u) : sprintf('%x-%x', time(), getpid());
};



export function ensure_backup_dir() {
	if (!access(BACKUP_DIR)) {
		mkdirp(BACKUP_DIR);
	}
	chmod(STUDIO_DIR, 0700);
	chmod(BACKUP_DIR, 0700);
};

export function md5(path) {
	if (!access(path))
		return '';
	const r = run('md5sum ' + shq(path));
	return r.code == 0 ? split(trim(r.out), ' ')[0] : '';
};

export function md5_string(s) {
	ensure_runtime();
	const f = sprintf('%s/.md5.%d', RUNTIME_DIR, getpid());
	writefile(f, s);
	const m = md5(f);
	unlink(f);
	return m;
};

export function parse_json(s) {
	let v = null;
	try {
		v = json(s);
	}
	catch (e) {
		return { error: 'invalid JSON output' };
	}
	return { value: v };
};

// Evaluate a yq expression on a YAML file and return the JSON result.
export function yq_json(expr, file) {
	const r = run('yq -M -o json -I0 ' + shq(expr) + ' ' + shq(file));
	if (r.code != 0)
		return { error: trim(r.err) || trim(r.out) || 'yq failed' };
	return parse_json(r.out);
};

export function yq_inplace(expr, file) {
	const r = run('yq -M -i ' + shq(expr) + ' ' + shq(file));
	if (r.code != 0)
		return { error: trim(r.err) || 'yq failed' };
	return { ok: true };
};

export function yq_test(expr, file) {
	return run('yq -M -e ' + shq(expr) + ' ' + shq(file) + ' >/dev/null').code == 0;
};

export function copy_file(src, dst) {
	const data = access(src) ? readfile(src) : '';
	return writefile(dst, data ?? '') != null;
};

// Atomic replace: write to a temp file in the same directory, keep mode, rename.
export function atomic_write(path, data) {
	const dir = replace(path, /\/[^\/]+$/, '');
	const base = replace(path, /^.*\//, '');
	const tmp = sprintf('%s/.%s.studio-tmp', dir, base);
	const st = stat(path);
	if (writefile(tmp, data) == null)
		return false;
	chmod(tmp, st ? st.mode : 0644);
	if (!rename(tmp, path)) {
		unlink(tmp);
		return false;
	}
	return true;
};

export function read_lines(path) {
	const s = readfile(path);
	if (!s)
		return [];
	return split(s, '\n');
};

/* ------------------------------------------------------------------ */
/* UTF-8 un-escaping of yq output                                      */
/* yq (go-yaml) writes non-BMP characters such as emoji as \UXXXXXXXX  */
/* inside double-quoted scalars. Restore them to literal UTF-8.        */
/* ------------------------------------------------------------------ */

function utf8(cp) {
	if (cp < 0x80)
		return chr(cp);
	if (cp < 0x800)
		return chr(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
	if (cp < 0x10000)
		return chr(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
	return chr(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
}

function is_hex(s) {
	return match(s, /^[0-9A-Fa-f]+$/) != null;
}

export function unescape_unicode(text) {
	if (index(text, '\\U') < 0 && index(text, '\\u') < 0)
		return text;
	let out = '';
	for (let line in split(text, '\n')) {
		let res = '';
		let i = 0, n = length(line);
		let state = 0; // 0 plain, 1 double quoted, 2 single quoted
		while (i < n) {
			const c = substr(line, i, 1);
			if (state == 0) {
				if (c == '#' && (i == 0 || substr(line, i - 1, 1) == ' ')) {
					res += substr(line, i);
					break;
				}
				if (c == '"')
					state = 1;
				else if (c == "'")
					state = 2;
				res += c;
				i++;
			}
			else if (state == 2) {
				if (c == "'") {
					if (substr(line, i + 1, 1) == "'") {
						res += "''";
						i += 2;
						continue;
					}
					state = 0;
				}
				res += c;
				i++;
			}
			else {
				if (c == '\\') {
					const nx = substr(line, i + 1, 1);
					let len = (nx == 'U') ? 8 : (nx == 'u') ? 4 : 0;
					if (len > 0) {
						const hx = substr(line, i + 2, len);
						if (length(hx) == len && is_hex(hx)) {
							const cp = hex(hx);
							if (cp >= 0xA0 && !(cp >= 0xD800 && cp <= 0xDFFF) && cp != 0xFEFF && cp != 0x2028 && cp != 0x2029) {
								res += utf8(cp);
								i += 2 + len;
								continue;
							}
						}
					}
					res += c + nx;
					i += 2;
					continue;
				}
				if (c == '"')
					state = 0;
				res += c;
				i++;
			}
		}
		out += res + '\n';
	}
	// the loop appends one newline too many
	return substr(out, 0, length(out) - 1);
};

/* ------------------------------------------------------------------ */
/* UCI / environment                                                   */
/* ------------------------------------------------------------------ */

export function uci_nikki() {
	const c = cursor();
	c.load('nikki');
	return c;
};

export function uci_bool(v) {
	return v == '1' || v == 'true' || v == 'yes' || v == 'on' || v == true;
};

export function valid_profile_name(name) {
	return type(name) == 'string' && match(name, /^[A-Za-z0-9_][A-Za-z0-9._-]*\.ya?ml$/) != null && length(name) <= 128;
};

// Resolve active profile from nikki.config.profile
export function resolve_source(c) {
	const profile = c.get('nikki', 'config', 'profile') ?? '';
	const m = match(profile, /^([a-z]+):(.*)$/);
	if (!m)
		return { error: 'NO_PROFILE', profile: profile };
	const type = m[1], id = m[2];
	if (type == 'file') {
		if (!valid_profile_name(id))
			return { error: 'BAD_PROFILE', profile: profile };
		return { type: 'file', id: id, name: id, path: PROFILES_DIR + '/' + id, exists: !!access(PROFILES_DIR + '/' + id), profile: profile };
	}
	if (type == 'subscription') {
		if (!match(id, /^[A-Za-z0-9_]+$/))
			return { error: 'BAD_PROFILE', profile: profile };
		const path = SUBSCRIPTIONS_DIR + '/' + id + '.yaml';
		return {
			type: 'subscription', id: id,
			name: c.get('nikki', id, 'name') ?? id,
			prefer: c.get('nikki', id, 'prefer') ?? 'remote',
			path: path, exists: !!access(path), profile: profile
		};
	}
	return { error: 'BAD_PROFILE', profile: profile };
};


// target: 'mixin' or 'profile:NAME'
export function resolve_target(target) {
	if (target == 'mixin')
		return { target: 'mixin', path: MIXIN_FILE, sections: MIXIN_SECTIONS, label: 'mixin' };
	const m = match(target ?? '', /^profile:(.+)$/);
	if (m && valid_profile_name(m[1])) {
		const path = PROFILES_DIR + '/' + m[1];
		if (!access(path))
			return null;
		return { target: target, path: path, sections: PROFILE_SECTIONS, label: 'profile--' + m[1], name: m[1] };
	}
	return null;
};

export function list_profiles() {
	const res = [];
	for (let f in (lsdir(PROFILES_DIR) ?? [])) {
		if (valid_profile_name(f))
			push(res, f);
	}
	return sort(res);
};

export function apk_versions(names) {
	const res = {};
	const r = run('apk list -I ' + join(' ', map(names, shq)));
	for (let line in split(r.out, '\n')) {
		for (let n in names) {
			const m = match(line, regexp('^' + replace(n, /[-.]/g, '\\$&') + '-([0-9][^ ]*)'));
			if (m && !res[n])
				res[n] = m[1];
		}
	}
	return res;
};

export function mihomo_version() {
	const r = run('/usr/bin/mihomo -v');
	const m = match(r.out, /Mihomo [^ ]* ?([^ \n]+)/);
	return m ? m[1] : trim(split(r.out, '\n')[0] ?? '');
};

export function openwrt_release() {
	const s = readfile('/etc/openwrt_release') ?? '';
	const m = match(s, /DISTRIB_RELEASE='([^']*)'/);
	const d = match(s, /DISTRIB_DESCRIPTION='([^']*)'/);
	return { release: m ? m[1] : '', description: d ? d[1] : '' };
};

export function release_supported(rel) {
	if (rel == 'SNAPSHOT' || index(rel, 'SNAPSHOT') >= 0)
		return true;
	const m = match(rel, /^([0-9]+)\.([0-9]+)/);
	if (!m)
		return false;
	const major = +m[1], minor = +m[2];
	return major > 25 || (major == 25 && minor >= 12);
};

export function merge_logic_ok() {
	const s = readfile(INIT_SCRIPT);
	return s != null && index(s, MERGE_CORE) >= 0;
};

export function environment(c) {
	const rel = openwrt_release();
	const kmods = {};
	for (let m in [ 'inet_diag', 'nft_socket', 'nft_tproxy', 'tun' ])
		kmods[m] = !!access('/sys/module/' + m);
	const conflicts = [];
	for (let n in [ 'openclash', 'passwall', 'passwall2', 'homeproxy', 'shellcrash', 'momo' ]) {
		if (access('/etc/init.d/' + n) && system([ '/etc/init.d/' + n, 'enabled' ]) == 0)
			push(conflicts, n);
	}
	let dns_redirect = false;
	const d = cursor();
	d.load('dhcp');
	d.foreach('dhcp', 'dnsmasq', (s) => {
		if (uci_bool(s.dns_redirect))
			dns_redirect = true;
	});
	return {
		release: rel.release,
		description: rel.description,
		release_supported: release_supported(rel.release),
		tools: {
			yq: !!access('/usr/bin/yq'),
			ucode: !!access('/usr/bin/ucode'),
			mihomo: !!access('/usr/bin/mihomo'),
			mixin_uc: !!access(MIXIN_UC),
		},
		kmods: kmods,
		conflicts: conflicts,
		dns_redirect: dns_redirect,
		merge_logic_ok: merge_logic_ok(),
	};
};

export function luci_rules(c) {
	const res = [];
	if (!uci_bool(c.get('nikki', 'mixin', 'rule')))
		return null;
	c.foreach('nikki', 'rule', (s) => {
		if (!uci_bool(s.enabled))
			return;
		const r = filter([ s.type, s.matcher, s.node, uci_bool(s.no_resolve) ? 'no-resolve' : null ], (x) => x != null && x != '');
		push(res, join(',', r));
	});
	return res;
};

export function luci_rule_providers(c) {
	const res = [];
	if (!uci_bool(c.get('nikki', 'mixin', 'rule_provider')))
		return res;
	c.foreach('nikki', 'rule_provider', (s) => {
		if (uci_bool(s.enabled) && s.name)
			push(res, s.name);
	});
	return res;
};

export function nikki_running() {
	return system('pidof mihomo >/dev/null 2>&1') == 0;
};

/* ------------------------------------------------------------------ */
/* Document read                                                       */
/* ------------------------------------------------------------------ */

export function load_doc(target) {
	const t = resolve_target(target);
	if (!t)
		return { error: 'BAD_TARGET' };
	const sections = {};
	const warnings = [];
	if (!access(t.path)) {
		for (let k in t.sections)
			sections[k] = { present: false, readonly: false, items: MAP_SECTIONS[k] ? {} : [] };
		return { target: t.target, path: t.path, md5: '', exists: false, sections: sections, warnings: warnings };
	}

	const keys = '[' + join(',', map(t.sections, (k) => '"' + k + '"')) + ']';
	const meta = yq_json(
		'(. // {}) as $r | ' +
		'{"present": (' + keys + ' | map(select(. as $k | $r | has($k)))), ' +
		' "doc_aliases": [$r | .. | select(kind == "alias") | alias], ' +
		' "anchors": (' + keys + ' | map(. as $k | {"key": $k, "anchors": [$r | .[$k] | .. | select(anchor != "") | anchor], "aliases": [$r | .[$k] | .. | select(kind == "alias") | alias]}))}',
		t.path);
	if (meta.error)
		return { error: 'PARSE_FAILED', detail: meta.error };

	const data = yq_json('explode(.) | (. // {}) as $r | {' + join(', ', map(t.sections, (k) => '"' + k + '": ($r | .["' + k + '"])')) + '}', t.path);
	if (data.error)
		return { error: 'PARSE_FAILED', detail: data.error };

	const present = {};
	for (let k in meta.value.present)
		present[k] = true;

	const anchor_info = {};
	for (let a in meta.value.anchors)
		anchor_info[a.key] = a;

	for (let k in t.sections) {
		const v = data.value[k];
		const isMap = MAP_SECTIONS[k];
		let items = v;
		if (isMap)
			items = (type(v) == 'object') ? v : {};
		else
			items = (type(v) == 'array') ? v : [];
		const ai = anchor_info[k] ?? { anchors: [], aliases: [] };
		let readonly = false, locked = false;
		if (length(ai.anchors) > 0 || length(ai.aliases) > 0) {
			readonly = true;
			// anchors defined in this section but referenced from outside -> cannot expand
			const own_alias_count = {};
			for (let x in ai.aliases)
				own_alias_count[x] = (own_alias_count[x] ?? 0) + 1;
			const doc_alias_count = {};
			for (let x in meta.value.doc_aliases)
				doc_alias_count[x] = (doc_alias_count[x] ?? 0) + 1;
			for (let a in ai.anchors) {
				if ((doc_alias_count[a] ?? 0) > (own_alias_count[a] ?? 0))
					locked = true;
			}
			push(warnings, { code: locked ? 'ANCHOR_LOCKED' : 'ANCHOR_IN_SECTION', section: k });
		}
		if (present[k] && v != null && type(v) != (isMap ? 'object' : 'array'))
			push(warnings, { code: 'BAD_SECTION_TYPE', section: k });
		sections[k] = { present: !!present[k], readonly: readonly, locked: locked, items: items };
	}

	return { target: t.target, path: t.path, md5: md5(t.path), exists: true, sections: sections, warnings: warnings };
};

export function load_source_summary(path) {
	const r = yq_json(
		'explode(.) | (. // {}) as $r | {' +
		'"proxies": [($r.proxies // [])[] | {"name": .name, "type": .type, "server": .server, "port": .port}], ' +
		'"groups": ($r["proxy-groups"] // []), ' +
		'"rules": ($r.rules // []), ' +
		'"rule_providers": (($r["rule-providers"] // {}) | keys), ' +
		'"proxy_providers": (($r["proxy-providers"] // {}) | keys), ' +
		'"sub_rules": (($r["sub-rules"] // {}) | keys)}',
		path);
	return r;
};

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

// Apply a patch object to a copy of the target file. Returns { path } or { error }.
export function build_candidate(t, patch, workdir) {
	const cand = workdir + '/candidate.yaml';
	const pfile = workdir + '/patch.json';
	if (!copy_file(t.path, cand))
		return { error: 'COPY_FAILED' };
	if (type(patch) != 'object')
		return { error: 'BAD_PATCH' };

	const allowed = {};
	for (let k in t.sections)
		allowed[k] = true;

	const exprs = [];
	const clean = {};
	for (let k, v in patch) {
		if (!allowed[k])
			return { error: 'BAD_PATCH_KEY', key: k };
		if (MAP_SECTIONS[k]) {
			if (v != null && type(v) != 'object')
				return { error: 'BAD_PATCH_VALUE', key: k };
			if (v == null || length(keys(v)) == 0)
				push(exprs, 'del(.["' + k + '"])');
			else {
				clean[k] = v;
				push(exprs, '.["' + k + '"] = (load("' + pfile + '")["' + k + '"] | ... style="")');
			}
		}
		else {
			if (v != null && type(v) != 'array')
				return { error: 'BAD_PATCH_VALUE', key: k };
			if (v == null || length(v) == 0)
				push(exprs, 'del(.["' + k + '"])');
			else {
				clean[k] = v;
				push(exprs, '.["' + k + '"] = (load("' + pfile + '")["' + k + '"] | ... style="")');
			}
		}
	}
	writefile(pfile, sprintf('%J', clean));
	if (length(exprs) > 0) {
		const r = yq_inplace(join(' | ', exprs), cand);
		if (r.error)
			return { error: 'PATCH_FAILED', detail: r.error };
		let text = readfile(cand) ?? '';
		text = unescape_unicode(text);
		// yq writes "{}" for an otherwise empty document; drop it to keep comment-only files clean
		text = replace(text, /(^|\n)\{\}\n?$/, '$1');
		writefile(cand, text);
	}
	return { path: cand, patch_file: pfile };
};

/* ------------------------------------------------------------------ */
/* Reference checks                                                    */
/* ------------------------------------------------------------------ */

function split_top(s) {
	// split by commas that are not inside parentheses
	const res = [];
	let depth = 0, cur = '';
	for (let i = 0; i < length(s); i++) {
		const c = substr(s, i, 1);
		if (c == '(')
			depth++;
		else if (c == ')')
			depth--;
		if (c == ',' && depth == 0) {
			push(res, cur);
			cur = '';
		}
		else
			cur += c;
	}
	push(res, cur);
	return res;
}

export function rule_parts(rule) {
	if (type(rule) != 'string')
		return null;
	const parts = map(split_top(rule), (x) => trim(x));
	const t = uc(parts[0] ?? '');
	if (t == 'MATCH')
		return { type: t, payload: null, target: parts[1] };
	if (t == 'SUB-RULE')
		return { type: t, payload: parts[1], target: parts[2], sub: true };
	return { type: t, payload: parts[1], target: parts[2] };
};

export function check_references(cfg, opts) {
	const errors = [], warnings = [];
	const proxies = (type(cfg.proxies) == 'array') ? cfg.proxies : [];
	const groups = (type(cfg['proxy-groups']) == 'array') ? cfg['proxy-groups'] : [];
	const rules = (type(cfg.rules) == 'array') ? cfg.rules : [];
	const rproviders = (type(cfg['rule-providers']) == 'object') ? cfg['rule-providers'] : {};
	const pproviders = (type(cfg['proxy-providers']) == 'object') ? cfg['proxy-providers'] : {};
	const subrules = (type(cfg['sub-rules']) == 'object') ? cfg['sub-rules'] : {};

	const names = {};
	for (let b in BUILTIN_POLICIES)
		names[b] = 'builtin';

	for (let p in proxies) {
		const n = p?.name;
		if (n == null || n == '') {
			push(errors, { code: 'PROXY_NO_NAME', msg: '存在没有名称的节点' });
			continue;
		}
		if (names[n] == 'proxy')
			push(errors, { code: 'DUP_PROXY', name: n, msg: sprintf('节点名称重复：%s', n) });
		names[n] = 'proxy';
	}
	const gmap = {};
	for (let g in groups) {
		const n = g?.name;
		if (n == null || n == '') {
			push(errors, { code: 'GROUP_NO_NAME', msg: '存在没有名称的策略组' });
			continue;
		}
		if (names[n] == 'group')
			push(errors, { code: 'DUP_GROUP', name: n, msg: sprintf('策略组名称重复：%s', n) });
		else if (names[n] == 'proxy')
			push(errors, { code: 'GROUP_PROXY_CLASH', name: n, msg: sprintf('策略组与节点同名：%s', n) });
		names[n] = 'group';
		gmap[n] = g;
	}

	for (let g in groups) {
		if (!g?.name)
			continue;
		for (let m in (type(g.proxies) == 'array' ? g.proxies : [])) {
			if (!names[m])
				push(errors, { code: 'GROUP_MEMBER_MISSING', name: g.name, member: m, msg: sprintf('策略组「%s」引用了不存在的节点或策略组「%s」', g.name, m) });
		}
		for (let u in (type(g.use) == 'array' ? g.use : [])) {
			if (pproviders[u] == null)
				push(errors, { code: 'GROUP_PROVIDER_MISSING', name: g.name, member: u, msg: sprintf('策略组「%s」引用了不存在的节点集合「%s」', g.name, u) });
		}
		const empty = !(length(g.proxies ?? []) > 0 || length(g.use ?? []) > 0 || g['include-all'] || g['include-all-proxies'] || g['include-all-providers']);
		if (empty)
			push(errors, { code: 'GROUP_EMPTY', name: g.name, msg: sprintf('策略组「%s」没有任何成员', g.name) });
	}

	// cycle detection among groups
	const state = {};
	let cycle = null;
	function visit(n, path) {
		if (cycle)
			return;
		state[n] = 1;
		for (let m in (type(gmap[n].proxies) == 'array' ? gmap[n].proxies : [])) {
			if (!gmap[m])
				continue;
			if (state[m] == 1) {
				cycle = [ ...path, n, m ];
				return;
			}
			if (!state[m])
				visit(m, [ ...path, n ]);
		}
		state[n] = 2;
	}
	for (let n in keys(gmap))
		if (!state[n])
			visit(n, []);
	if (cycle)
		push(errors, { code: 'GROUP_CYCLE', msg: '策略组存在循环引用：' + join(' → ', cycle) });

	const n_rules = length(rules);
	for (let i = 0; i < n_rules; i++) {
		const r = rules[i];
		const p = rule_parts(r);
		if (!p) {
			push(errors, { code: 'RULE_INVALID', index: i, msg: sprintf('第 %d 条规则格式无效', i + 1) });
			continue;
		}
		if (p.sub) {
			if (subrules[p.target] == null)
				push(errors, { code: 'SUBRULE_MISSING', index: i, msg: sprintf('第 %d 条规则引用了不存在的子规则「%s」：%s', i + 1, p.target, r) });
			continue;
		}
		if (p.target == null || p.target == '') {
			push(errors, { code: 'RULE_NO_TARGET', index: i, msg: sprintf('第 %d 条规则缺少目标：%s', i + 1, r) });
			continue;
		}
		if (!names[p.target])
			push(errors, { code: 'RULE_TARGET_MISSING', index: i, msg: sprintf('第 %d 条规则指向不存在的策略组或节点「%s」：%s', i + 1, p.target, r) });
		if (p.type == 'RULE-SET' && rproviders[p.payload] == null)
			push(errors, { code: 'RULE_SET_MISSING', index: i, msg: sprintf('第 %d 条规则引用了不存在的规则集「%s」', i + 1, p.payload) });
		if (p.type == 'MATCH' && i != n_rules - 1)
			push(warnings, { code: 'MATCH_NOT_LAST', index: i, msg: sprintf('第 %d 条是 MATCH 兜底规则，但后面还有 %d 条规则不会生效', i + 1, n_rules - 1 - i) });
	}

	if (opts?.prepend_match)
		push(warnings, { code: 'MATCH_IN_PREPEND', msg: '「插在订阅前」的规则中包含 MATCH，订阅自带的规则将全部失效' });
	if (opts?.replace_proxies)
		push(warnings, { code: 'REPLACE_PROXIES', msg: '混入文件使用了顶层 proxies，订阅中的全部节点会被替换' });

	return { errors: errors, warnings: warnings };
};

/* ------------------------------------------------------------------ */
/* Validation pipeline                                                 */
/* ------------------------------------------------------------------ */

function fail(stage, msg, extra) {
	return { ok: false, stage: stage, message: msg, ...(extra ?? {}) };
}

export function find_timeout() {
	for (let p in [ '/usr/bin/timeout', '/bin/timeout', '/usr/sbin/timeout' ])
		if (access(p))
			return p;
	return null;
};

// Simulate Nikki start-up merge and validate. `progress` is called with stage names.
export function validate(target, patch, workdir, progress) {
	progress ??= () => null;
	const c = uci_nikki();
	const t = resolve_target(target);
	if (!t)
		return fail('precheck', '无效的编辑目标');

	progress('precheck');
	const env = environment(c);
	if (!env.tools.yq || !env.tools.ucode || !env.tools.mihomo || !env.tools.mixin_uc)
		return fail('precheck', '缺少必要组件（yq / ucode / mihomo / mixin.uc），请检查 Nikki 是否完整安装');
	const core_only = uci_bool(c.get('nikki', 'config', 'core_only'));
	if (core_only)
		return fail('precheck', 'Nikki 处于「仅核心」模式，混入与代理都不会生效，请先在 Nikki 插件配置中关闭');
	const mixin_file = uci_bool(c.get('nikki', 'mixin', 'mixin_file_content'));
	if (t.target == 'mixin' && !mixin_file)
		return fail('precheck', 'Nikki 未启用混入文件（mixin_file_content），保存后不会生效。请在概览页一键开启', { code: 'MIXIN_DISABLED' });
	const luci_rule_on = uci_bool(c.get('nikki', 'mixin', 'rule'));
	if (t.target == 'mixin' && luci_rule_on && type(patch?.['nikki-rules']) == 'array' && length(patch['nikki-rules']) > 0)
		return fail('precheck', '已开启 LuCI 原生规则（混入配置 → 规则），它会在启动时整体覆盖混入文件里的「插在订阅前」规则。请改用「替换订阅规则」或关闭 LuCI 规则', { code: 'LUCI_RULE_CONFLICT' });

	progress('candidate');
	const cand = build_candidate(t, patch ?? {}, workdir);
	if (cand.error)
		return fail('candidate', '生成候选配置失败：' + (cand.detail ?? cand.error));

	progress('source');
	const src = resolve_source(c);
	if (src.error)
		return fail('source', 'Nikki 未选择配置文件或订阅，请先在 Nikki 插件配置中选择');
	let base = src.path;
	if (t.target != 'mixin' && t.path == src.path)
		base = cand.path;
	if (!access(base))
		return fail('source', src.type == 'subscription' ? sprintf('订阅「%s」尚未下载，请先在 Nikki 中更新订阅', src.name) : sprintf('配置文件 %s 不存在', src.name));
	const config = workdir + '/config.yaml';
	if (!copy_file(base, config))
		return fail('source', '复制配置来源失败');

	progress('overwrite');
	const dels = [];
	for (let o in OVERWRITES)
		if (uci_bool(c.get('nikki', 'mixin', o[0])))
			push(dels, o[1]);
	if (length(dels) > 0) {
		const r = yq_inplace(join(' | ', dels), config);
		if (r.error)
			return fail('overwrite', '处理覆盖选项失败：' + r.error);
	}

	progress('merge');
	const luci_json = workdir + '/luci.json';
	const luci_yaml = workdir + '/luci.yaml';
	let r = run('ucode -S ' + shq(MIXIN_UC) + ' > ' + shq(luci_json));
	if (r.code != 0)
		return fail('merge', '执行 Nikki mixin.uc 失败：' + trim(r.err));
	r = run('yq -M -p json -o yaml ' + shq(luci_json) + ' > ' + shq(luci_yaml));
	if (r.code != 0)
		return fail('merge', '转换 LuCI 混入设置失败：' + trim(r.err));

	let mixin_arg = '';
	if (mixin_file) {
		if (t.target == 'mixin')
			mixin_arg = cand.path;
		else if (access(MIXIN_FILE))
			mixin_arg = MIXIN_FILE;
	}
	const final = workdir + '/final.yaml';
	r = run('yq -M eval-all ' + shq(MERGE_EXPR) + ' ' + shq(config) + (mixin_arg ? ' ' + shq(mixin_arg) : '') + ' ' + shq(luci_yaml) + ' > ' + shq(final));
	if (r.code != 0)
		return fail('merge', '合并配置失败：' + trim(r.err));

	progress('postprocess');
	const proxy_enabled = uci_bool(c.get('nikki', 'proxy', 'enabled'));
	if (proxy_enabled) {
		if (yq_test('has("tun")', final)) {
			const x = yq_inplace('(.tun) |= (.auto-route = false | .auto-redirect = false | .auto-detect-interface = false | .disable-icmp-forwarding = true)', final);
			if (x.error)
				return fail('postprocess', 'TUN 后处理失败：' + x.error);
		}
		if (yq_test('has("listeners")', final)) {
			const x = yq_inplace('(.listeners[] | select(.type == "tun")) |= (.auto-route = false | .auto-redirect = false | .auto-detect-interface = false | .disable-icmp-forwarding = true)', final);
			if (x.error)
				return fail('postprocess', 'TUN 后处理失败：' + x.error);
		}
	}

	progress('nikki_check');
	if (proxy_enabled) {
		const v4 = uci_bool(c.get('nikki', 'proxy', 'ipv4_dns_hijack'));
		const v6 = uci_bool(c.get('nikki', 'proxy', 'ipv6_dns_hijack'));
		const tcp_mode = c.get('nikki', 'proxy', 'tcp_mode') ?? '';
		const udp_mode = c.get('nikki', 'proxy', 'udp_mode') ?? '';
		const rl = c.get('nikki', 'core', 'redirect_listener_name') ?? '';
		const tl = c.get('nikki', 'core', 'tproxy_listener_name') ?? '';
		const ul = c.get('nikki', 'core', 'tun_listener_name') ?? '';
		const q = (s) => replace(s, /["\\]/g, '\\$&');
		if ((v4 || v6) && yq_test('(has("dns") and (.dns | .enable) and (.dns | has("listen"))) | not', final))
			return fail('nikki_check', '已开启 DNS 劫持，但配置中 dns.enable 未开启或未设置 dns.listen');
		if (tcp_mode == 'redirect' && yq_test('(has("redir-port") or (has("listeners") and .listeners | any_c(.name == "' + q(rl) + '" and .type == "redir"))) | not', final))
			return fail('nikki_check', 'TCP 代理模式为 Redirect，但配置中没有 redir-port 或对应的 listener');
		if ((tcp_mode == 'tproxy' || udp_mode == 'tproxy') && yq_test('(has("tproxy-port") or (has("listeners") and .listeners | any_c(.name == "' + q(tl) + '" and .type == "tproxy"))) | not', final))
			return fail('nikki_check', '代理模式为 TPROXY，但配置中没有 tproxy-port 或对应的 listener');
		if ((tcp_mode == 'tun' || udp_mode == 'tun') && yq_test('(has("tun") and (.tun | .enable) and (.tun | has("device"))) or (has("listeners") and .listeners | any_c(.name == "' + q(ul) + '" and .type == "tun" and has("device"))) | not', final))
			return fail('nikki_check', '代理模式为 TUN，但配置中 TUN 未启用或未设置 device');
	}

	progress('references');
	const fj = yq_json('.', final);
	if (fj.error)
		return fail('references', '读取合并结果失败：' + fj.error);
	const cfg = fj.value ?? {};
	const prepend_match = (t.target == 'mixin' && type(patch?.['nikki-rules']) == 'array') ? length(filter(patch['nikki-rules'], (x) => match(x ?? '', /^\s*MATCH\s*,/))) > 0 : false;
	const replace_proxies = (t.target == 'mixin' && type(patch?.proxies) == 'array' && length(patch.proxies) > 0);
	const refs = check_references(cfg, { prepend_match: prepend_match, replace_proxies: replace_proxies });
	if (length(refs.errors) > 0)
		return fail('references', '配置存在引用错误', { errors: refs.errors, warnings: refs.warnings });

	progress('core');
	const safe_paths = c.get('nikki', 'procd', 'env_safe_paths');
	const sp = (type(safe_paths) == 'array') ? join(':', safe_paths) : (safe_paths ?? '');
	const to = find_timeout();
	r = run('cd ' + shq(RUN_DIR) + ' && SAFE_PATHS=' + shq(sp) + ' ' + (to ? to + ' 90 ' : '') + '/usr/bin/mihomo -d ' + shq(RUN_DIR) + ' -f ' + shq(final) + ' -t 2>&1');
	const core_output = trim(r.out);
	if (r.code != 0)
		return fail('core', r.code == 124 ? 'Mihomo 校验超时' : 'Mihomo 内核校验未通过', { core_output: core_output, warnings: refs.warnings });

	return {
		ok: true,
		stage: 'done',
		message: '校验通过',
		warnings: refs.warnings,
		core_output: core_output,
		final_md5: md5(final),
		source_note: (src.type == 'subscription' && src.prefer == 'remote') ? '订阅设置为「优先远程」，Nikki 启动时会重新下载订阅，最终结果可能与本次校验不同' : null,
		stats: {
			proxies: length(cfg.proxies ?? []),
			groups: length(cfg['proxy-groups'] ?? []),
			rules: length(cfg.rules ?? []),
		}
	};
};

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

export const BACKUP_RE = /^([0-9]{8}-[0-9]{6})(-[0-9]+)?__(mixin|profile--[A-Za-z0-9_][A-Za-z0-9._-]*\.ya?ml)\.yaml$/;

export function label_target(label) {
	if (label == 'mixin')
		return 'mixin';
	const m = match(label, /^profile--(.+)$/);
	return m ? 'profile:' + m[1] : null;
};

export function prune_backups(label) {
	const items = [];
	for (let f in (lsdir(BACKUP_DIR) ?? [])) {
		const m = match(f, BACKUP_RE);
		if (m && m[3] == label)
			push(items, f);
	}
	sort(items);
	while (length(items) > MAX_BACKUPS) {
		const f = shift(items);
		unlink(BACKUP_DIR + '/' + f);
		unlink(BACKUP_DIR + '/' + f + '.json');
	}
};

export function create_backup(t, source, note) {
	ensure_backup_dir();
	let name = timestamp() + '__' + t.label + '.yaml';
	let i = 1;
	while (access(BACKUP_DIR + '/' + name)) {
		name = timestamp() + '-' + i + '__' + t.label + '.yaml';
		i++;
	}
	const exists = !!access(t.path);
	const path = BACKUP_DIR + '/' + name;
	writefile(path, exists ? (readfile(t.path) ?? '') : '');
	chmod(path, 0600);
	const versions = apk_versions([ 'nikki' ]);
	writefile(path + '.json', sprintf('%J', {
		name: name, target: t.target, label: t.label, time: time(), md5: md5(t.path),
		absent: !exists, nikki: versions.nikki ?? '', source: source, note: note ?? ''
	}));
	chmod(path + '.json', 0600);
	prune_backups(t.label);
	return name;
};

export function list_backups(target) {
	const res = [];
	for (let f in (lsdir(BACKUP_DIR) ?? [])) {
		const m = match(f, BACKUP_RE);
		if (!m)
			continue;
		const meta = parse_json(readfile(BACKUP_DIR + '/' + f + '.json') ?? 'null').value ?? {};
		const tg = label_target(m[3]);
		if (target && tg != target)
			continue;
		const st = stat(BACKUP_DIR + '/' + f);
		push(res, {
			name: f, target: tg, time: meta.time ?? (st ? st.mtime : 0), size: st ? st.size : 0,
			source: meta.source ?? 'save', note: meta.note ?? '', nikki: meta.nikki ?? '', absent: !!meta.absent
		});
	}
	return sort(res, (a, b) => (b.time - a.time) || (a.name < b.name ? 1 : -1));
};


/* ------------------------------------------------------------------ */
/* Lock & jobs                                                         */
/* ------------------------------------------------------------------ */

export function lock_acquire(owner) {
	ensure_runtime();
	for (let attempt = 0; attempt < 2; attempt++) {
		if (mkdir(LOCK_DIR, 0700)) {
			writefile(LOCK_DIR + '/owner', owner ?? '');
			return true;
		}
		const st = stat(LOCK_DIR);
		if (st && st.mtime < time() - LOCK_STALE) {
			unlink(LOCK_DIR + '/owner');
			rmdir(LOCK_DIR);
			continue;
		}
		return false;
	}
	return false;
};

export function lock_release() {
	unlink(LOCK_DIR + '/owner');
	rmdir(LOCK_DIR);
};

export function lock_held() {
	const st = stat(LOCK_DIR);
	return st != null && st.mtime >= time() - LOCK_STALE;
};

export function job_dir(id) {
	return JOBS_DIR + '/' + id;
};

export function valid_job_id(id) {
	return type(id) == 'string' && match(id, /^[0-9a-f-]{8,64}$/) != null;
};

export function write_status(id, st) {
	const p = job_dir(id) + '/status.json';
	writefile(p + '.tmp', sprintf('%J', st));
	rename(p + '.tmp', p);
};

export function read_status(id) {
	return parse_json(readfile(job_dir(id) + '/status.json') ?? 'null').value;
};

export function prune_jobs() {
	const items = [];
	for (let f in (lsdir(JOBS_DIR) ?? [])) {
		const st = stat(JOBS_DIR + '/' + f);
		if (st && st.type == 'directory')
			push(items, { name: f, mtime: st.mtime });
	}
	sort(items, (a, b) => a.mtime - b.mtime);
	while (length(items) > KEEP_JOBS + 5) {
		const it = shift(items);
		const s = read_status(it.name);
		if (s && s.state == 'running')
			continue;
		system([ 'rm', '-rf', JOBS_DIR + '/' + it.name ]);
	}
};

/* ------------------------------------------------------------------ */
/* Mihomo API                                                          */
/* ------------------------------------------------------------------ */

export function api_endpoint() {
	const r = yq_json('{"http": .["external-controller"], "tls": .["external-controller-tls"], "secret": .secret}', RUN_PROFILE);
	if (r.error || !r.value)
		return null;
	const v = r.value;
	let addr = v.tls ?? v.http;
	if (!addr)
		return null;
	const proto = v.tls ? 'https' : 'http';
	// normalise listen address to loopback
	let port = null, host = '127.0.0.1';
	let m = match(addr, /^\[([^\]]*)\]:([0-9]+)$/);
	if (m) {
		host = (m[1] == '' || m[1] == '::') ? '127.0.0.1' : '[' + m[1] + ']';
		port = m[2];
	}
	else {
		m = match(addr, /^([^:]*):([0-9]+)$/);
		if (!m)
			return null;
		host = (m[1] == '' || m[1] == '0.0.0.0') ? '127.0.0.1' : m[1];
		port = m[2];
	}
	return { base: proto + '://' + host + ':' + port, secret: v.secret ?? '' };
};

export function api_get(path, timeout) {
	const ep = api_endpoint();
	if (!ep)
		return { error: 'API_NOT_CONFIGURED' };
	ensure_runtime();
	const hdr = sprintf('%s/.hdr.%d', RUNTIME_DIR, getpid());
	writefile(hdr, ep.secret != '' ? 'Authorization: Bearer ' + ep.secret + '\n' : '\n');
	chmod(hdr, 0600);
	const r = run('curl -s -k --max-time ' + (+timeout || 5) + ' -H @' + shq(hdr) + ' ' + shq(ep.base + path));
	unlink(hdr);
	if (r.code != 0)
		return { error: 'API_UNREACHABLE', code: r.code };
	const j = parse_json(r.out);
	if (j.error)
		return { error: 'API_BAD_RESPONSE', body: substr(r.out, 0, 200) };
	return { value: j.value };
};
