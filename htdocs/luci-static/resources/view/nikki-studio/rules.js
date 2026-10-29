'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var P = ns.P;
var PAGE = 100;

var PRESETS = [
	{ id: 'lan', title: '局域网直连', rules: [ 'GEOSITE,private,DIRECT', 'GEOIP,private,DIRECT,no-resolve' ] },
	{ id: 'ads', title: '广告拦截', rules: [ 'GEOSITE,category-ads-all,REJECT' ] },
	{ id: 'ai', title: 'AI 服务（OpenAI / Claude）', target: true, rules: [ 'GEOSITE,openai,{T}', 'GEOSITE,anthropic,{T}' ] },
	{ id: 'opencode', title: 'OpenCode', target: true, rules: [ 'DOMAIN-SUFFIX,opencode.ai,{T}', 'DOMAIN-SUFFIX,models.dev,{T}' ] },
	{ id: 'github', title: 'GitHub', target: true, rules: [ 'GEOSITE,github,{T}' ] },
	{ id: 'google', title: 'Google', target: true, rules: [ 'GEOSITE,google,{T}' ] },
	{ id: 'telegram', title: 'Telegram', target: true, rules: [ 'GEOSITE,telegram,{T}', 'GEOIP,telegram,{T},no-resolve' ] },
	{ id: 'media', title: '流媒体（YouTube / Netflix）', target: true, rules: [ 'GEOSITE,youtube,{T}', 'GEOSITE,netflix,{T}' ] },
	{ id: 'cn', title: '国内网站直连', rules: [ 'GEOSITE,cn,DIRECT', 'GEOIP,cn,DIRECT,no-resolve' ] },
	{ id: 'final', title: '兜底（其余流量）', target: true, rules: [ 'MATCH,{T}' ] }
];

var PAYLOAD_HINT = {
	'DOMAIN': 'www.example.com', 'DOMAIN-SUFFIX': 'example.com（同时匹配其所有子域名）', 'DOMAIN-KEYWORD': 'google',
	'DOMAIN-WILDCARD': '*.example.com', 'DOMAIN-REGEX': '^ad\\.', 'GEOSITE': 'cn、google、openai、category-ads-all…',
	'IP-CIDR': '192.168.0.0/16', 'IP-CIDR6': '2001:db8::/32', 'GEOIP': 'cn、private、telegram…', 'IP-ASN': '13335',
	'SRC-IP-CIDR': '192.168.1.100/32（局域网设备）', 'DST-PORT': '443 或 8000-9000', 'SRC-PORT': '12345', 'IN-PORT': '7890',
	'NETWORK': 'tcp 或 udp', 'PROCESS-NAME': 'opencode', 'AND': '((DOMAIN,a.com),(NETWORK,udp))', 'OR': '((DOMAIN,a.com),(DOMAIN,b.com))',
	'NOT': '((DOMAIN,a.com))', 'SUB-RULE': '(NETWORK,tcp)'
};

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.page = 0;
		this.query = '';
		this.content = E('div', {});
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 规则'),
			E('div', { 'class': 'cbi-map-descr' }, '规则从上到下依次匹配，命中第一条即停止。把需要单独分流的域名放在前面，指向对应的策略组。'),
			ns.renderHeader(session),
			this.content
		]);
	},

	refresh: function() { dom.content(this.content, this.build()); },
	sec: function() { return this.session.currentSection('rules'); },

	build: function() {
		var session = this.session, self = this, sec = this.sec(), items = session.items(sec), editable = session.editable(sec);
		var out = [ ns.renderModeTabs(session, 'rules', function() { self.page = 0; self.refresh(); }), ns.lockedNotice(session, sec) ];
		if (sec == 'nikki-rules' && session.state.luci_rules)
			out.push(E('div', { 'class': 'alert-message danger' }, 'Nikki 插件中已开启「混入配置 → 规则」，启动时会覆盖这里的追加规则，校验会被拒绝。请关闭 LuCI 规则，或改用「替换订阅的全部规则」。'));
		if (sec == 'rules' && session.isMixin())
			out.push(E('div', { 'class': 'alert-message notice' }, '此列表非空时会完全替换订阅中的规则。可先「从订阅复制全部规则」再修改，最后一条通常应为 MATCH 兜底规则。'));

		var search = ns.input(this.query, { placeholder: '搜索规则…' });
		search.addEventListener('input', function() { self.query = search.value; self.page = 0; dom.content(self.tableWrap, self.table()); search.focus(); });
		var bar = [];
		if (editable) bar = bar.concat([
			ns.btn('添加规则', 'cbi-button-add', function() { return self.editDialog(-1); }),
			ns.btn('常用预设', 'cbi-button-add', function() { return self.presetDialog(); }),
			ns.btn('批量导入', '', function() { return self.importDialog(); }),
			(sec == 'rules' && session.isMixin() && session.source && (session.source.rules || []).length) ? ns.btn('从订阅复制全部规则', '', function() {
				var go = function() { session.setItems(sec, session.source.rules.slice()); };
				if (!items.length) return go();
				return ns.confirmDialog('从订阅复制', '将用订阅中的 ' + session.source.rules.length + ' 条规则覆盖当前列表，确定？', '覆盖').then(function(ok) { if (ok) go(); });
			}) : '',
			items.length ? ns.btn('清空', 'cbi-button-negative', function() {
				return ns.confirmDialog('清空规则', '确定删除当前列表中的全部 ' + items.length + ' 条规则？', '清空', true).then(function(ok) { if (ok) session.setItems(sec, []); });
			}) : ''
		]);
		bar.push(E('span', { 'class': 'ns-grow' }));
		bar.push(E('span', { 'style': 'min-width:14em' }, [ search ]));
		out.push(E('div', { 'class': 'ns-bar' }, bar));

		this.tableWrap = E('div', {}, this.table());
		out.push(this.tableWrap);
		out.push(this.testerSection());
		out.push(this.effectiveSection());
		return out;
	},

	filtered: function() {
		var items = this.session.items(this.sec()), q = this.query.trim().toLowerCase(), res = [];
		items.forEach(function(r, i) { if (!q || String(r).toLowerCase().indexOf(q) >= 0) res.push(i); });
		return res;
	},

	table: function() {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec), editable = session.editable(sec);
		var idxs = this.filtered();
		var pages = Math.max(1, Math.ceil(idxs.length / PAGE));
		if (this.page >= pages) this.page = pages - 1;
		var slice = idxs.slice(this.page * PAGE, (this.page + 1) * PAGE);
		var policies = {};
		session.policyNames().forEach(function(n) { policies[n] = true; });
		var t = E('table', { 'class': 'table ns-list' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:3em' }, '#'),
				E('th', { 'class': 'th' }, '类型'),
				E('th', { 'class': 'th' }, '匹配内容'),
				E('th', { 'class': 'th' }, '策略'),
				E('th', { 'class': 'th' }, '选项'),
				E('th', { 'class': 'th ns-actions' }, '')
			])
		]);
		if (!slice.length)
			t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': 6 }, E('em', {}, this.query ? '没有匹配的规则' : '暂无规则，点击「添加规则」或「常用预设」')) ]));
		slice.forEach(function(i) {
			var raw = items[i], r = P.parseRule(raw);
			var tgt = r.target;
			var tgtNode = (r.invalid || r.type == 'SUB-RULE' || policies[tgt]) ? tgt : E('span', { 'title': '找不到该策略组/节点' }, [ tgt, ' ', ns.badge('不存在', 'err') ]);
			var acts = editable ? [
				E('button', { 'class': 'cbi-button cbi-button-edit', 'click': function() { self.editDialog(i); } }, '编辑'),
				E('button', { 'class': 'cbi-button', 'title': '上移', 'click': function() { if (ns.moveItem(items, i, i - 1)) session.touch(sec); } }, '↑'),
				E('button', { 'class': 'cbi-button', 'title': '下移', 'click': function() { if (ns.moveItem(items, i, i + 1)) session.touch(sec); } }, '↓'),
				E('button', { 'class': 'cbi-button', 'title': '移到最前', 'click': function() { if (ns.moveItem(items, i, 0)) session.touch(sec); } }, '置顶'),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() { items.splice(i, 1); session.touch(sec); } }, '删除')
			] : [];
			var tr = E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, editable && !self.query ? E('span', { 'class': 'ns-drag', 'title': '拖动排序' }, '≡ ' + (i + 1)) : String(i + 1)),
				E('td', { 'class': 'td', 'title': P.RULE_TYPE_DESC[r.type] || '' }, r.invalid ? [ ns.badge('格式错误', 'err'), ' ', String(raw) ] : r.type),
				E('td', { 'class': 'td' }, r.invalid ? '' : r.payload),
				E('td', { 'class': 'td' }, r.invalid ? '' : tgtNode),
				E('td', { 'class': 'td' }, r.options.join(',')),
				E('td', { 'class': 'td ns-actions' }, acts)
			]);
			if (editable && !self.query) ns.makeDraggable(tr, i, function(from, to) { if (ns.moveItem(items, from, to)) session.touch(sec); });
			t.appendChild(tr);
		});
		return E('div', {}, [ t, ns.pager(idxs.length, this.page, PAGE, function(p) { self.page = p; dom.content(self.tableWrap, self.table()); }) ]);
	},

	effectiveRules: function() {
		return this.session.effective('rules').map(function(e) { return { rule: e.v, origin: e.origin, index: e.index }; });
	},

	testerSection: function() {
		var self = this;
		var q = ns.input(ns.lsGet('nikki-studio.test', ''), { placeholder: '输入域名或 IPv4，例如 api.openai.com' });
		var res = E('div', {});
		var run = function() {
			ns.lsSet('nikki-studio.test', q.value);
			if (!q.value.trim()) return dom.content(res, '');
			var list = self.effectiveRules();
			var r = P.testRules(list, q.value);
			var out = [];
			if (r.index >= 0) {
				var m = list[r.index];
				out.push(E('p', {}, [ '命中第 ', E('strong', {}, String(r.index + 1)), ' 条（', ns.originLabel(m.origin), m.index != null ? ' #' + (m.index + 1) : '', '）：',
					E('code', {}, P.formatRule(r.rule)), ' → ', E('strong', {}, r.rule.target) ]));
			}
			else out.push(E('p', {}, '没有规则命中（Mihomo 会使用 DIRECT）。'));
			if (r.maybes.length)
				out.push(E('div', { 'class': 'alert-message notice' }, [
					E('p', {}, '以下更靠前的规则依赖 GeoSite/GeoIP 数据库、规则集或 DNS 解析，无法在浏览器中判断，实际可能先命中它们：'),
					E('ul', {}, r.maybes.map(function(x) { return E('li', {}, [ '#' + (x.index + 1) + ' ', E('code', {}, P.formatRule(x.rule)), '（' + ns.originLabel(x.origin) + '）' ]); }))
				]));
			dom.content(res, out);
		};
		q.addEventListener('keydown', function(ev) { if (ev.key == 'Enter') run(); });
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '规则测试'),
			E('div', { 'class': 'ns-bar' }, [ E('span', { 'style': 'flex:1' }, [ q ]), E('button', { 'class': 'cbi-button cbi-button-action', 'click': run }, '测试') ]),
			E('div', { 'class': 'ns-help' }, '按 Nikki 启动后的实际顺序（包含你尚未保存的修改）在本地模拟匹配。'),
			res
		]);
		if (q.value) window.setTimeout(run, 0);
		return node;
	},

	effectiveSection: function() {
		var session = this.session;
		if (!session.isMixin()) return '';
		var list = this.effectiveRules();
		var counts = {};
		list.forEach(function(e) { counts[e.origin] = (counts[e.origin] || 0) + 1; });
		var seg = [];
		if (counts.luci) seg.push('LuCI 规则 ' + counts.luci + ' 条');
		if (counts['nikki-rules']) seg.push('追加规则 ' + counts['nikki-rules'] + ' 条');
		if (counts.rules) seg.push('替换规则 ' + counts.rules + ' 条');
		if (counts.source) seg.push('订阅规则 ' + counts.source + ' 条');
		var shown = list.slice(0, 300);
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '生效顺序预览'),
			E('p', {}, seg.length ? seg.join(' → ') : '无规则'),
			ns.details('展开查看前 ' + shown.length + ' 条', E('div', { 'class': 'ns-diff' }, shown.map(function(e, i) {
				return E('div', { 'class': e.origin == 'source' ? '' : 'add' }, (i + 1) + '. [' + ns.originLabel(e.origin) + '] ' + e.rule);
			})))
		]);
	},

	editDialog: function(idx) {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec);
		var r = idx >= 0 ? P.parseRule(items[idx]) : { type: 'DOMAIN-SUFFIX', payload: '', target: '', options: [] };
		if (r.invalid && idx >= 0) r = { type: 'DOMAIN-SUFFIX', payload: '', target: '', options: [], raw: items[idx] };
		var fType = ns.select(r.type, P.RULE_TYPES.map(function(t) { return [ t, t + '　' + (P.RULE_TYPE_DESC[t] || '') ]; }));
		var fPayload = ns.input(r.payload);
		var rsNames = session.ruleSetNames();
		var fRuleSet = ns.select(r.type == 'RULE-SET' ? r.payload : '', [ [ '', '— 选择规则集 —' ] ].concat(rsNames));
		var choices = session.policyChoices();
		var fTarget = E('select', { 'class': 'cbi-input-select' });
		var hasTarget = false;
		choices.forEach(function(g) {
			var og = E('optgroup', { 'label': g.label });
			g.items.forEach(function(n) { var o = E('option', { 'value': n }, n); if (n === r.target) { o.selected = true; hasTarget = true; } og.appendChild(o); });
			if (g.items.length) fTarget.appendChild(og);
		});
		if (r.target && !hasTarget) fTarget.insertBefore(E('option', { 'value': r.target, 'selected': 'selected' }, r.target + '（不存在）'), fTarget.firstChild);
		var fSub = ns.select(r.type == 'SUB-RULE' ? r.target : '', session.subRuleNames());
		var fNoResolve = ns.checkbox(r.options.indexOf('no-resolve') >= 0, 'no-resolve（不为域名发起 DNS 解析）');
		var fSrc = ns.checkbox(r.options.indexOf('src') >= 0, 'src（匹配来源 IP）');
		var otherOpts = r.options.filter(function(o) { return o != 'no-resolve' && o != 'src'; });
		var fPos = ns.select('top', [ [ 'top', '列表最前（优先匹配）' ], [ 'bottom', '列表末尾' ] ]);
		var hint = E('div', { 'class': 'ns-help' });
		var payloadRow = ns.row('匹配内容', E('div', {}, [ fPayload, fRuleSet, hint ]));
		var targetRow = ns.row('策略', E('div', {}, [ fTarget, fSub ]), '命中后使用的策略组 / 节点；DIRECT 为直连，REJECT 为拒绝。');
		var optRow = ns.row('选项', E('div', {}, [ fNoResolve, fSrc ]));
		var err = E('div', {});
		function upd() {
			var t = fType.value;
			payloadRow.style.display = t == 'MATCH' ? 'none' : '';
			fRuleSet.style.display = t == 'RULE-SET' ? '' : 'none';
			fPayload.style.display = t == 'RULE-SET' && rsNames.length ? 'none' : '';
			fTarget.style.display = t == 'SUB-RULE' ? 'none' : '';
			fSub.style.display = t == 'SUB-RULE' ? '' : 'none';
			hint.textContent = PAYLOAD_HINT[t] ? '例如：' + PAYLOAD_HINT[t] : '';
			fNoResolve.style.display = P.IP_RULES[t] ? '' : 'none';
			fSrc.style.display = t == 'RULE-SET' ? '' : 'none';
			optRow.style.display = (P.IP_RULES[t] || t == 'RULE-SET') ? '' : 'none';
		}
		fType.addEventListener('change', upd);
		ui.showModal(idx >= 0 ? '编辑规则' : '添加规则', [
			r.raw && idx >= 0 && P.parseRule(items[idx]).invalid ? E('div', { 'class': 'alert-message warning' }, '原规则无法解析：' + r.raw) : '',
			E('div', { 'class': 'ns-form' }, [
				ns.row('类型', fType),
				payloadRow,
				targetRow,
				optRow,
				idx < 0 ? ns.row('插入位置', fPos) : ''
			]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					var t = fType.value;
					var o = { type: t, payload: t == 'RULE-SET' && rsNames.length ? fRuleSet.value : fPayload.value.trim(), target: t == 'SUB-RULE' ? fSub.value : fTarget.value, options: [] };
					if (P.IP_RULES[t] && ns.cbOf(fNoResolve).checked) o.options.push('no-resolve');
					if (t == 'RULE-SET' && ns.cbOf(fSrc).checked) o.options.push('src');
					o.options = o.options.concat(otherOpts);
					if (t != 'MATCH' && !o.payload) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '请填写匹配内容'));
					if (!o.target) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '请选择策略'));
					if (t != 'MATCH' && /,/.test(o.payload) && [ 'AND', 'OR', 'NOT', 'SUB-RULE' ].indexOf(t) < 0) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '匹配内容中不能包含逗号'));
					var s = P.formatRule(o);
					ui.hideModal();
					if (idx >= 0) items[idx] = s;
					else if (fPos.value == 'top') items.unshift(s);
					else items.push(s);
					session.touch(sec);
				} }, '确定')
			])
		]);
		upd();
	},

	presetDialog: function() {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec);
		var groups = session.groupNames();
		var choices = groups.concat(P.BUILTIN_POLICIES);
		var boxes = PRESETS.map(function(p) {
			var cb = ns.checkbox(false, p.title);
			var tsel = p.target ? ns.select(groups[0] || 'DIRECT', choices) : null;
			return { p: p, cb: cb, tsel: tsel };
		});
		var fPos = ns.select('top', [ [ 'top', '列表最前' ], [ 'bottom', '列表末尾' ] ]);
		ui.showModal('常用规则预设', [
			E('p', { 'class': 'ns-help' }, 'GEOSITE / GEOIP 规则依赖 Mihomo 的地理数据库（Nikki 默认自动下载）。勾选需要的预设并选择目标策略。'),
			E('table', { 'class': 'table' }, boxes.map(function(b) {
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, b.cb),
					E('td', { 'class': 'td' }, b.tsel || E('em', {}, '→ ' + P.parseRule(b.p.rules[0]).target)),
					E('td', { 'class': 'td', 'style': 'font-family:monospace;font-size:85%' }, b.p.rules.join('\n'))
				]);
			})),
			E('div', { 'class': 'ns-form' }, [ ns.row('插入位置', fPos, 'MATCH 兜底规则始终添加到末尾') ]),
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					var add = [], tail = [];
					boxes.forEach(function(b) {
						if (!ns.cbOf(b.cb).checked) return;
						b.p.rules.forEach(function(r) {
							var s = r.replace('{T}', b.tsel ? b.tsel.value : '');
							if (items.indexOf(s) >= 0) return;
							(/^MATCH,/.test(s) ? tail : add).push(s);
						});
					});
					ui.hideModal();
					if (!add.length && !tail.length) return;
					if (fPos.value == 'top') Array.prototype.unshift.apply(items, add); else Array.prototype.push.apply(items, add);
					if (tail.length) {
						for (var i = items.length - 1; i >= 0; i--) if (/^MATCH,/.test(items[i])) items.splice(i, 1);
						items.push(tail[tail.length - 1]);
					}
					session.touch(sec);
					ns.notify('已添加 ' + (add.length + tail.length) + ' 条规则', 'info');
				} }, '添加')
			])
		]);
	},

	importDialog: function() {
		var session = this.session, sec = this.sec(), items = session.items(sec);
		var ta = ns.textarea('', 12, 'DOMAIN-SUFFIX,opencode.ai,🧑‍💻 OpenCode\nIP-CIDR,1.2.3.0/24,DIRECT,no-resolve\n\n也支持直接粘贴 YAML 列表（- DOMAIN,...）');
		var fPos = ns.select('top', [ [ 'top', '列表最前' ], [ 'bottom', '列表末尾' ] ]);
		var err = E('div', {});
		ui.showModal('批量导入规则', [
			E('div', { 'class': 'ns-form' }, [ ns.row('规则', ta, '每行一条，格式：类型,匹配内容,策略[,选项]。以 # 开头的行会被忽略。'), ns.row('插入位置', fPos) ]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					var r = P.parseRuleLines(ta.value);
					if (!r.rules.length) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '没有可导入的规则'));
					if (fPos.value == 'top') Array.prototype.unshift.apply(items, r.rules); else Array.prototype.push.apply(items, r.rules);
					ui.hideModal();
					session.touch(sec);
					ns.notify('已导入 ' + r.rules.length + ' 条规则' + (r.bad.length ? '，忽略 ' + r.bad.length + ' 行无法识别的内容：' + r.bad.slice(0, 5).join('；') : ''), r.bad.length ? 'warning' : 'info');
				} }, '导入')
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
