'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var P = ns.P;
var GH = 'https://github.com/MetaCubeX/meta-rules-dat/raw/meta/geo/';
var CDN = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/';
var PRESETS = [
	[ 'geosite', 'cn', '国内域名' ], [ 'geosite', 'geolocation-!cn', '境外域名' ], [ 'geosite', 'category-ads-all', '广告域名' ],
	[ 'geosite', 'private', '局域网域名' ], [ 'geosite', 'openai', 'OpenAI' ], [ 'geosite', 'anthropic', 'Anthropic' ],
	[ 'geosite', 'github', 'GitHub' ], [ 'geosite', 'google', 'Google' ], [ 'geosite', 'telegram', 'Telegram' ],
	[ 'geosite', 'youtube', 'YouTube' ], [ 'geosite', 'netflix', 'Netflix' ], [ 'geosite', 'apple', 'Apple' ],
	[ 'geosite', 'microsoft', 'Microsoft' ], [ 'geoip', 'cn', '国内 IP' ], [ 'geoip', 'private', '局域网 IP' ],
	[ 'geoip', 'telegram', 'Telegram IP' ], [ 'geoip', 'netflix', 'Netflix IP' ]
];
var KNOWN = [ 'type', 'behavior', 'format', 'url', 'path', 'interval', 'proxy', 'payload', 'size-limit' ];

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.content = E('div', {});
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 规则集'),
			E('div', { 'class': 'cbi-map-descr' }, '规则集（rule-providers）是从网络下载或内联定义的一组规则，在规则中通过 RULE-SET,名称,策略 引用。比 GEOSITE 更灵活、更新更及时。'),
			ns.renderHeader(session),
			this.content
		]);
	},

	refresh: function() { dom.content(this.content, this.build()); },
	sec: function() { return 'rule-providers'; },
	rulesSec: function() {
		// never start a "replace" list implicitly: only use `rules` in mixin mode when it is already in use
		if (!this.session.isMixin()) return 'rules';
		return (this.session.currentSection('rules') == 'rules' && this.session.items('rules').length) ? 'rules' : 'nikki-rules';
	},

	build: function() {
		var session = this.session, self = this, sec = this.sec(), map = session.items(sec), editable = session.editable(sec);
		var out = [ ns.lockedNotice(session, sec) ];
		if (editable) out.push(E('div', { 'class': 'ns-bar' }, [
			ns.btn('添加规则集', 'cbi-button-add', function() { return self.editDialog(null); }),
			ns.btn('从预设添加', 'cbi-button-add', function() { return self.presetDialog(); })
		]));
		var used = {};
		session.effective('rules').forEach(function(e) { var r = P.parseRule(e.v); if (r.type == 'RULE-SET') used[r.payload] = (used[r.payload] || 0) + 1; });
		var names = Object.keys(map);
		var t = E('table', { 'class': 'table ns-list' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, '名称'), E('th', { 'class': 'th' }, '类型'), E('th', { 'class': 'th' }, '行为 / 格式'),
				E('th', { 'class': 'th' }, '来源'), E('th', { 'class': 'th' }, '被引用'), E('th', { 'class': 'th ns-actions' }, '')
			])
		]);
		if (!names.length) t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': 6 }, E('em', {}, '暂无规则集')) ]));
		names.forEach(function(n) {
			var p = map[n] || {};
			t.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, n),
				E('td', { 'class': 'td' }, p.type || ''),
				E('td', { 'class': 'td' }, (p.behavior || '') + ' / ' + (p.format || 'yaml')),
				E('td', { 'class': 'td' }, p.type == 'inline' ? ((p.payload || []).length + ' 条内联规则') : (p.url || p.path || '')),
				E('td', { 'class': 'td' }, used[n] ? used[n] + ' 条规则' : ns.badge('未使用', 'warn')),
				E('td', { 'class': 'td ns-actions' }, editable ? [
					E('button', { 'class': 'cbi-button cbi-button-edit', 'click': function() { self.editDialog(n); } }, '编辑'),
					E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() {
						var go = function() { delete map[n]; session.touch(sec); };
						if (!used[n]) return go();
						ns.confirmDialog('删除规则集', '有 ' + used[n] + ' 条规则引用「' + n + '」，删除后需要同时删除这些规则，否则校验会失败。确定删除？', '删除', true).then(function(ok) { if (ok) go(); });
					} }, '删除')
				] : [])
			]));
		});
		out.push(t);
		if (session.isMixin() && session.source)
			out.push(E('div', { 'class': 'cbi-section' }, [
				ns.details('订阅中的规则集（' + (session.source.rule_providers || []).length + ' 个）', E('p', {}, (session.source.rule_providers || []).join('、') || '无'))
			]));
		if ((session.state.luci_rule_providers || []).length)
			out.push(E('p', { 'class': 'ns-help' }, 'Nikki 插件中定义的规则集：' + session.state.luci_rule_providers.join('、')));
		return out;
	},

	addRuleRow: function() {
		var groups = this.session.groupNames();
		var cb = ns.checkbox(true, '同时在规则列表最前添加 RULE-SET 规则，指向：');
		var tsel = ns.select(groups[0] || 'DIRECT', groups.concat(P.BUILTIN_POLICIES));
		return { node: E('div', {}, [ cb, tsel ]), cb: cb, tsel: tsel };
	},

	pushRule: function(name, behavior, target) {
		var rsec = this.rulesSec(), rules = this.session.items(rsec);
		var s = 'RULE-SET,' + name + ',' + target + (behavior == 'ipcidr' ? ',no-resolve' : '');
		if (rules.indexOf(s) < 0) { rules.unshift(s); this.session.touch(rsec); }
	},

	editDialog: function(name) {
		var self = this, session = this.session, sec = this.sec(), map = session.items(sec);
		var p = name ? P.clone(map[name]) : { type: 'http', behavior: 'domain', format: 'mrs', interval: 86400 };
		var rest = {};
		Object.keys(p).forEach(function(k) { if (KNOWN.indexOf(k) < 0) rest[k] = p[k]; });
		var fName = ns.input(name || '', { placeholder: '例如：opencode' });
		var fType = ns.select(p.type, [ [ 'http', 'http（从网络下载）' ], [ 'file', 'file（本地文件）' ], [ 'inline', 'inline（直接写在配置里）' ] ]);
		var fBeh = ns.select(p.behavior, [ [ 'domain', 'domain（域名）' ], [ 'ipcidr', 'ipcidr（IP 段）' ], [ 'classical', 'classical（完整规则）' ] ]);
		var fFmt = ns.select(p.format || 'yaml', [ 'yaml', 'text', 'mrs' ]);
		var fUrl = ns.input(p.url, { placeholder: 'https://…' });
		var fPath = ns.input(p.path, { placeholder: '可选，例如 ./rules/opencode.mrs' });
		var fInt = ns.input(p.interval, { type: 'number', placeholder: '86400' });
		var fProxy = ns.select(p.proxy || '', [ [ '', '默认（DIRECT）' ] ].concat(session.groupNames(), P.BUILTIN_POLICIES));
		var fPayload = ns.textarea((p.payload || []).join('\n'), 6, 'domain 行为示例：\n+.opencode.ai\nclassical 行为示例：\nDOMAIN-SUFFIX,opencode.ai');
		var fRest = ns.textarea(Object.keys(rest).length ? P.dumpYaml(rest) : '', 3);
		var ar = name ? null : this.addRuleRow();
		var rowsHttp = E('div', {}, [ ns.row('URL', fUrl), ns.row('更新间隔（秒）', fInt), ns.row('下载使用的策略', fProxy) ]);
		var rowPath = ns.row('路径', fPath, 'http 类型可留空（自动生成）；file 类型必填，相对于 /etc/nikki/run');
		var rowFmt = ns.row('格式', fFmt, 'mrs 为二进制格式，体积小加载快，仅支持 domain / ipcidr 行为');
		var rowPayload = ns.row('内联规则', fPayload, '每行一条');
		var err = E('div', {});
		function upd() {
			var t = fType.value;
			rowsHttp.style.display = t == 'http' ? '' : 'none';
			rowPath.style.display = t == 'inline' ? 'none' : '';
			rowFmt.style.display = t == 'inline' ? 'none' : '';
			rowPayload.style.display = t == 'inline' ? '' : 'none';
		}
		fType.addEventListener('change', upd);
		ui.showModal(name ? '编辑规则集' : '添加规则集', [
			E('div', { 'class': 'ns-form' }, [
				ns.row('名称', fName), ns.row('类型', fType), ns.row('行为', fBeh), rowFmt, rowsHttp, rowPath, rowPayload,
				ns.details('其他参数（YAML）', fRest),
				ar ? ns.row('规则', ar.node) : ''
			]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': ui.createHandlerFn(this, function() {
					var n = fName.value.trim(), t = fType.value;
					var fail = function(m) { dom.content(err, E('div', { 'class': 'alert-message danger' }, m)); };
					if (!n || /[,\s]/.test(n)) return fail('请填写名称（不能包含逗号或空格）');
					if (n !== name && (map[n] || session.ruleSetNames().indexOf(n) >= 0)) return fail('名称「' + n + '」已存在');
					var o = { type: t, behavior: fBeh.value };
					if (t != 'inline') o.format = fFmt.value;
					if (o.format == 'mrs' && o.behavior == 'classical') return fail('mrs 格式不支持 classical 行为');
					if (t == 'http') {
						if (!/^https?:\/\//.test(fUrl.value.trim())) return fail('请填写有效的 URL');
						o.url = fUrl.value.trim();
						o.interval = fInt.value !== '' ? +fInt.value : 86400;
						if (fProxy.value) o.proxy = fProxy.value;
					}
					if (t != 'inline' && fPath.value.trim()) o.path = fPath.value.trim();
					if (t == 'file' && !o.path) return fail('file 类型需要填写路径');
					if (t == 'inline') {
						o.payload = fPayload.value.split(/\r?\n/).map(function(x) { return x.trim(); }).filter(function(x) { return x && x.charAt(0) != '#'; });
						if (!o.payload.length) return fail('请填写内联规则');
					}
					var txt = fRest.value.trim();
					return (txt ? ns.yamlToJson(txt) : Promise.resolve({})).then(function(extra) {
						if (extra && typeof(extra) == 'object' && !Array.isArray(extra))
							Object.keys(extra).forEach(function(k) { if (KNOWN.indexOf(k) < 0) o[k] = extra[k]; });
						ui.hideModal();
						if (name && name !== n) {
							delete map[name];
							var cnt = 0;
							[ 'rules', 'nikki-rules' ].forEach(function(k) {
								var arr = session.work[k];
								if (!arr) return;
								var ch = false;
								arr.forEach(function(s, i) { var r = P.parseRule(s); if (r.type == 'RULE-SET' && r.payload === name) { r.payload = n; arr[i] = P.formatRule(r); ch = true; cnt++; } });
								if (ch) session.touch(k);
							});
							if (cnt) ns.notify('已同步更新 ' + cnt + ' 条引用该规则集的规则', 'info');
						}
						map[n] = o;
						session.touch(sec);
						if (ar && ns.cbOf(ar.cb).checked) self.pushRule(n, o.behavior, ar.tsel.value);
					}).catch(function(e) { fail(ns.errText(e)); });
				}) }, '确定')
			])
		]);
		upd();
	},

	presetDialog: function() {
		var self = this, session = this.session, sec = this.sec(), map = session.items(sec);
		var useCdn = ns.checkbox(false, '使用 jsDelivr 镜像下载（国内网络更稳定）');
		var ar = this.addRuleRow();
		var boxes = PRESETS.map(function(x) { return { x: x, cb: ns.checkbox(false, x[2] + '（' + x[0] + ':' + x[1] + '）') }; });
		ui.showModal('从预设添加规则集', [
			E('p', { 'class': 'ns-help' }, '来源：MetaCubeX/meta-rules-dat，mrs 格式，每天更新一次。'),
			E('div', { 'style': 'display:grid;grid-template-columns:1fr 1fr;gap:.2em 1em' }, boxes.map(function(b) { return b.cb; })),
			E('div', { 'class': 'ns-form' }, [ ns.row('', useCdn), ns.row('规则', ar.node, '国内 IP / 局域网等直连类规则集请在添加后手动把规则改为 DIRECT。') ]),
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					var base = ns.cbOf(useCdn).checked ? CDN : GH, n = 0;
					boxes.forEach(function(b) {
						if (!ns.cbOf(b.cb).checked) return;
						var kind = b.x[0], key = b.x[1], name = kind + '-' + key;
						var beh = kind == 'geoip' ? 'ipcidr' : 'domain';
						if (!map[name]) { map[name] = { type: 'http', behavior: beh, format: 'mrs', url: base + kind + '/' + key + '.mrs', interval: 86400 }; n++; }
						if (ns.cbOf(ar.cb).checked) self.pushRule(name, beh, (key == 'private' || key == 'cn') ? 'DIRECT' : (key == 'category-ads-all' ? 'REJECT' : ar.tsel.value));
					});
					ui.hideModal();
					session.touch(sec);
					if (n) ns.notify('已添加 ' + n + ' 个规则集', 'info');
				} }, '添加')
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
