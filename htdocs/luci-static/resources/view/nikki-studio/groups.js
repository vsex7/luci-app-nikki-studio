'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var P = ns.P;
var GTYPES = [ [ 'select', 'select（手动选择）' ], [ 'url-test', 'url-test（自动选最快）' ], [ 'fallback', 'fallback（故障转移）' ], [ 'load-balance', 'load-balance（负载均衡）' ], [ 'relay', 'relay（链式代理）' ] ];
var KNOWN = [ 'name', 'type', 'proxies', 'use', 'include-all', 'include-all-proxies', 'include-all-providers', 'filter', 'exclude-filter', 'exclude-type', 'url', 'interval', 'tolerance', 'lazy', 'strategy', 'icon', 'hidden', 'disable-udp', 'timeout', 'max-failed-times' ];
var FILTER_PRESETS = [
	[ '', '— 常用筛选 —' ],
	[ '(?i)港|HK|Hong ?Kong|🇭🇰', '香港' ],
	[ '(?i)台|TW|Taiwan|🇹🇼', '台湾' ],
	[ '(?i)日本|JP|Japan|🇯🇵', '日本' ],
	[ '(?i)新加坡|狮城|SG|Singapore|🇸🇬', '新加坡' ],
	[ '(?i)美国|US|United States|America|🇺🇸', '美国' ],
	[ '(?i)韩国|KR|Korea|🇰🇷', '韩国' ],
	[ '(?i)英国|UK|Britain|🇬🇧', '英国' ],
	[ '(?i)德国|DE|Germany|🇩🇪', '德国' ]
];
var EXCLUDE_PRESET = '(?i)剩余|到期|官网|流量|套餐|重置|过期|expire|traffic|reset';
var GROUP_EMOJI = [ '🚀', '⚡', '🧑‍💻', '🤖', '🌟', '🪙', '💻', '🎬', '📺', '🎮', '🍎', 'Ⓜ️', '📲', '🌍', '🇭🇰', '🇯🇵', '🇺🇸', '🇸🇬', '🇹🇼', '🇬🇧', '🎯', '🛑', '🐟' ];

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.content = E('div', {});
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 策略组'),
			E('div', { 'class': 'cbi-map-descr' }, '创建或修改策略组（例如为 OpenCode、AI 服务、流媒体单独分组）。策略组可以引用节点、其他策略组，或按关键字自动筛选订阅节点。'),
			ns.renderHeader(session),
			this.content
		]);
	},

	refresh: function() { dom.content(this.content, this.build()); },
	sec: function() { return this.session.currentSection('groups'); },

	takenNames: function(exceptName) {
		var t = {};
		this.session.policyNames().forEach(function(n) { if (n !== exceptName) t[n] = true; });
		return t;
	},

	summary: function(g) {
		var parts = [];
		if ((g.proxies || []).length) parts.push(g.proxies.length + ' 个成员');
		if ((g.use || []).length) parts.push('节点订阅：' + g.use.join('、'));
		if (g['include-all']) parts.push('包含全部节点与订阅');
		else {
			if (g['include-all-proxies']) parts.push('包含全部节点');
			if (g['include-all-providers']) parts.push('包含全部节点订阅');
		}
		if (g.filter) parts.push('筛选：' + g.filter);
		if (g['exclude-filter']) parts.push('排除：' + g['exclude-filter']);
		var first = (g.proxies || []).slice(0, 3).join('、');
		return parts.join('；') + (first ? '（' + first + ((g.proxies || []).length > 3 ? '…' : '') + '）' : '');
	},

	build: function() {
		var session = this.session, self = this, sec = this.sec(), items = session.items(sec), editable = session.editable(sec);
		var isReplace = session.isMixin() && sec == 'proxy-groups';
		var out = [ ns.renderModeTabs(session, 'groups', function() { self.refresh(); }), ns.lockedNotice(session, sec) ];
		if (isReplace)
			out.push(E('div', { 'class': 'alert-message notice' }, '此列表非空时会完全替换订阅中的策略组。可先「从订阅复制全部策略组」，再在此基础上修改。规则中引用的策略组必须仍然存在。'));
		if (editable) out.push(E('div', { 'class': 'ns-bar' }, [
			ns.btn('新建策略组', 'cbi-button-add', function() { return self.editDialog(-1); }),
			isReplace && session.source && (session.source.groups || []).length ? ns.btn('从订阅复制全部策略组', '', function() {
				var go = function() { session.setItems(sec, P.clone(session.source.groups)); };
				if (!items.length) return go();
				return ns.confirmDialog('从订阅复制', '将用订阅中的 ' + session.source.groups.length + ' 个策略组覆盖当前列表，确定？', '覆盖').then(function(ok) { if (ok) go(); });
			}) : ''
		]));
		out.push(this.table(items, editable, false));

		if (session.isMixin() && session.source) {
			var src = session.source.groups || [];
			out.push(E('div', { 'class': 'cbi-section' }, [
				ns.details('订阅中的策略组（' + src.length + ' 个' + (session.items('proxy-groups').length ? '，已被「替换」列表取代' : '') + '）', this.table(src, false, true))
			]));
		}
		return out;
	},

	table: function(items, editable, isSrc) {
		var self = this, session = this.session, sec = this.sec();
		var t = E('table', { 'class': 'table ns-list' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:2em' }, '#'),
				E('th', { 'class': 'th' }, '名称'),
				E('th', { 'class': 'th' }, '类型'),
				E('th', { 'class': 'th' }, '成员'),
				E('th', { 'class': 'th ns-actions' }, '')
			])
		]);
		if (!items.length)
			t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': 5 }, E('em', {}, isSrc ? '无' : '暂无策略组')) ]));
		items.forEach(function(g, i) {
			g = g || {};
			var acts = [];
			if (isSrc && session.editable(sec)) acts.push(E('button', { 'class': 'cbi-button', 'title': '复制一份到当前编辑列表，再进行修改', 'click': function() {
				var c = P.clone(g);
				if (sec != 'proxy-groups') c.name = P.uniqueName(g.name + ' 副本', self.takenNames());
				session.items(sec).push(c); session.touch(sec);
				ns.notify('已复制策略组「' + g.name + '」到当前列表' + (sec != 'proxy-groups' ? '，名称为「' + c.name + '」' : ''), 'info');
			} }, '复制到当前列表'));
			if (editable) acts = acts.concat([
				E('button', { 'class': 'cbi-button cbi-button-edit', 'click': function() { self.editDialog(i); } }, '编辑'),
				E('button', { 'class': 'cbi-button', 'title': '上移', 'click': function() { if (ns.moveItem(items, i, i - 1)) session.touch(sec); } }, '↑'),
				E('button', { 'class': 'cbi-button', 'title': '下移', 'click': function() { if (ns.moveItem(items, i, i + 1)) session.touch(sec); } }, '↓'),
				E('button', { 'class': 'cbi-button', 'click': function() {
					var c = P.clone(g); c.name = P.uniqueName(g.name + ' 副本', self.takenNames());
					items.splice(i + 1, 0, c); session.touch(sec);
				} }, '复制'),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() {
					ns.confirmDelete(session, '策略组', g.name).then(function(ok) { if (ok) { items.splice(i, 1); session.touch(sec); } });
				} }, '删除')
			]);
			var tr = E('tr', { 'class': 'tr' + (isSrc ? ' ns-src' : '') }, [
				E('td', { 'class': 'td' }, editable ? E('span', { 'class': 'ns-drag', 'title': '拖动排序' }, '≡ ' + (i + 1)) : String(i + 1)),
				E('td', { 'class': 'td' }, g.name || E('em', {}, '（无名称）')),
				E('td', { 'class': 'td' }, g.type || ''),
				E('td', { 'class': 'td' }, self.summary(g)),
				E('td', { 'class': 'td ns-actions' }, acts)
			]);
			if (editable) ns.makeDraggable(tr, i, function(from, to) { if (ns.moveItem(items, from, to)) session.touch(sec); });
			t.appendChild(tr);
		});
		return t;
	},

	editDialog: function(idx) {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec);
		var g = idx >= 0 ? P.clone(items[idx]) : { name: '', type: 'select', proxies: [] };
		var oldName = g.name;
		var rest = {};
		Object.keys(g).forEach(function(k) { if (KNOWN.indexOf(k) < 0) rest[k] = g[k]; });

		var fName = ns.input(g.name, { placeholder: '例如：🧑‍💻 OpenCode' });
		var emoji = E('div', { 'style': 'margin-top:.3em' }, GROUP_EMOJI.map(function(e) {
			return E('button', { 'class': 'cbi-button', 'style': 'padding:0 .3em', 'click': function(ev) { ev.preventDefault(); fName.value = e + ' ' + fName.value.replace(/^\S+\s+/, function(m) { return GROUP_EMOJI.indexOf(m.trim()) >= 0 ? '' : m; }); } }, e);
		}));
		var fType = ns.select(g.type || 'select', GTYPES);
		var members = ns.memberEditor(g.proxies || [], session.policyChoices(oldName));
		var pp = session.proxyProviderNames();
		var useEd = pp.length || (g.use || []).length ? ns.memberEditor(g.use || [], [ { label: '节点订阅（proxy-providers）', items: pp } ]) : null;
		var fAll = ns.checkbox(g['include-all'], '包含全部节点与节点订阅（include-all）');
		var fAllP = ns.checkbox(g['include-all-proxies'], '包含全部节点（include-all-proxies）');
		var fAllPv = ns.checkbox(g['include-all-providers'], '包含全部节点订阅（include-all-providers）');
		var fFilter = ns.input(g.filter, { placeholder: '(?i)港|HK' });
		var fPreset = ns.select('', FILTER_PRESETS);
		fPreset.addEventListener('change', function() {
			if (!fPreset.value) return;
			fFilter.value = fFilter.value ? fFilter.value + '`' + fPreset.value : fPreset.value;
			fPreset.value = '';
			if (!ns.cbOf(fAll).checked && !ns.cbOf(fAllP).checked) ns.cbOf(fAllP).checked = true;
			updatePreview();
		});
		var fExclude = ns.input(g['exclude-filter'], { placeholder: EXCLUDE_PRESET });
		var fExPreset = E('button', { 'class': 'cbi-button', 'click': function(ev) { ev.preventDefault(); fExclude.value = EXCLUDE_PRESET; updatePreview(); } }, '排除信息类节点');
		var fExType = ns.input(g['exclude-type'], { placeholder: '例如：http|socks5' });
		var fUrl = ns.input(g.url, { placeholder: 'https://www.gstatic.com/generate_204' });
		var fInterval = ns.input(g.interval, { type: 'number', placeholder: '300' });
		var fTol = ns.input(g.tolerance, { type: 'number', placeholder: '50' });
		var fLazy = ns.checkbox(g.lazy !== false && g.lazy != null ? g.lazy : false, '未使用时不测速（lazy）');
		var fStrategy = ns.select(g.strategy || '', [ [ '', '默认（consistent-hashing）' ], 'consistent-hashing', 'round-robin', 'sticky-sessions' ]);
		var fIcon = ns.input(g.icon, { placeholder: '图标 URL（可选）' });
		var fHidden = ns.checkbox(g.hidden, '在面板中隐藏（hidden）');
		var fNoUdp = ns.checkbox(g['disable-udp'], '禁用 UDP');
		var fRest = ns.textarea(Object.keys(rest).length ? P.dumpYaml(rest) : '', 4, '其他参数（YAML，可选）');
		var preview = E('div', { 'class': 'ns-help' });
		var testRow = E('div', {});
		var err = E('div', {});

		function collect() {
			var o = { name: fName.value.trim(), type: fType.value };
			var m = members.getValue();
			if (m.length) o.proxies = m;
			var u = useEd ? useEd.getValue() : [];
			if (u.length) o.use = u;
			if (ns.cbOf(fAll).checked) o['include-all'] = true;
			if (ns.cbOf(fAllP).checked) o['include-all-proxies'] = true;
			if (ns.cbOf(fAllPv).checked) o['include-all-providers'] = true;
			if (fFilter.value.trim()) o.filter = fFilter.value.trim();
			if (fExclude.value.trim()) o['exclude-filter'] = fExclude.value.trim();
			if (fExType.value.trim()) o['exclude-type'] = fExType.value.trim();
			if (o.type != 'select' && o.type != 'relay') {
				if (fUrl.value.trim()) o.url = fUrl.value.trim();
				if (fInterval.value !== '') o.interval = +fInterval.value;
				if (o.type == 'url-test' && fTol.value !== '') o.tolerance = +fTol.value;
				if (ns.cbOf(fLazy).checked) o.lazy = true;
			}
			if (o.type == 'load-balance' && fStrategy.value) o.strategy = fStrategy.value;
			if (fIcon.value.trim()) o.icon = fIcon.value.trim();
			if (ns.cbOf(fHidden).checked) o.hidden = true;
			if (ns.cbOf(fNoUdp).checked) o['disable-udp'] = true;
			[ 'timeout', 'max-failed-times' ].forEach(function(k) { if (g[k] != null) o[k] = g[k]; });
			return o;
		}
		function updatePreview() {
			var o = collect();
			if (!o.filter && !o['exclude-filter'] && !o['exclude-type'] && !o['include-all'] && !o['include-all-proxies']) { dom.content(preview, ''); return; }
			var r = P.previewGroup(o, session.proxyList());
			if (r.error) return dom.content(preview, E('span', { 'style': 'color:#b5372e' }, '正则错误：' + r.error));
			var auto = r.members.filter(function(n) { return (o.proxies || []).indexOf(n) < 0; });
			dom.content(preview, '预览：当前可匹配 ' + auto.length + ' 个节点' + (auto.length ? '：' + auto.slice(0, 30).join('、') + (auto.length > 30 ? '…' : '') : '') +
				((o['include-all'] || o['include-all-providers'] || o.use) ? '（不含节点订阅中的节点）' : ''));
		}
		function updateType() {
			var t = fType.value;
			testRow.style.display = (t == 'select' || t == 'relay') ? 'none' : '';
		}
		[ fFilter, fExclude, fExType ].forEach(function(f) { f.addEventListener('input', updatePreview); });
		[ fAll, fAllP ].forEach(function(f) { ns.cbOf(f).addEventListener('change', updatePreview); });
		fType.addEventListener('change', updateType);

		dom.content(testRow, [
			ns.row('测速地址', fUrl),
			ns.row('测速间隔（秒）', fInterval),
			ns.row('容差（毫秒）', fTol, '仅 url-test：新节点比当前节点快超过该值才切换'),
			ns.row('负载均衡策略', fStrategy, '仅 load-balance'),
			ns.row('', fLazy)
		]);

		ui.showModal(idx >= 0 ? '编辑策略组' : '新建策略组', [
			E('div', { 'class': 'ns-form', 'style': 'max-height:70vh;overflow:auto' }, [
				ns.row('名称', E('div', {}, [ fName, emoji ]), '名称必须唯一；规则通过名称指向策略组。'),
				ns.row('类型', fType),
				ns.row('成员', members.node),
				useEd ? ns.row('节点订阅', useEd.node) : '',
				ns.row('自动包含', E('div', {}, [ fAll, E('br'), fAllP, E('br'), fAllPv ]), '勾选后再配合下面的「筛选」，即可按关键字自动挑选订阅中的节点，订阅更新后自动生效。'),
				ns.row('筛选（filter）', E('div', {}, [ fFilter, fPreset ]), '正则表达式，(?i) 表示不区分大小写，多个表达式用 ` 分隔。只作用于自动包含的节点。'),
				ns.row('排除（exclude-filter）', E('div', {}, [ fExclude, fExPreset ])),
				ns.row('排除类型', fExType, '按协议类型排除，用 | 分隔'),
				E('div', {}, preview),
				testRow,
				ns.details('更多选项', E('div', {}, [ ns.row('图标', fIcon), ns.row('', E('div', {}, [ fHidden, fNoUdp ])), ns.row('其他参数', fRest) ]))
			]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': ui.createHandlerFn(this, function() {
					var o = collect();
					if (!o.name) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '请填写名称'));
					if (self.takenNames(oldName)[o.name]) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '名称「' + o.name + '」已被其他节点或策略组使用'));
					if ((o.proxies || []).indexOf(o.name) >= 0) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '策略组不能包含自己'));
					if (!o.proxies && !o.use && !o['include-all'] && !o['include-all-proxies'] && !o['include-all-providers'])
						return dom.content(err, E('div', { 'class': 'alert-message danger' }, '策略组至少需要一个成员，或勾选「自动包含」'));
					try { if (o.filter) P.filterMatcher(o.filter); if (o['exclude-filter']) P.filterMatcher(o['exclude-filter']); }
					catch (e) { return dom.content(err, E('div', { 'class': 'alert-message danger' }, '正则表达式错误：' + e.message)); }
					var txt = fRest.value.trim();
					return (txt ? ns.yamlToJson(txt) : Promise.resolve({})).then(function(extra) {
						if (extra && typeof(extra) == 'object' && !Array.isArray(extra))
							Object.keys(extra).forEach(function(k) { if (KNOWN.indexOf(k) < 0) o[k] = extra[k]; });
						else if (extra != null) throw new Error('「其他参数」必须是 键: 值 形式的 YAML');
						ui.hideModal();
						if (idx >= 0) items[idx] = o; else items.push(o);
						session.touch(sec);
						if (idx >= 0 && oldName && oldName !== o.name) {
							var n = ns.cascadeRename(session, oldName, o.name);
							if (n) ns.notify('已同步更新本文件中 ' + n + ' 处对「' + oldName + '」的引用', 'info');
							var refs = ns.referencesInDoc(session, oldName);
							if (refs.srcGroups.length || refs.srcRules)
								ns.notify('订阅中仍有策略组或规则引用旧名称「' + oldName + '」，校验时可能报错', 'warning');
						}
						if (idx < 0) ns.notify('已添加策略组「' + o.name + '」。别忘了在「规则」页把需要的域名指向它。', 'info');
					}).catch(function(e) { dom.content(err, E('div', { 'class': 'alert-message danger' }, ns.errText(e))); });
				}) }, '确定')
			])
		]);
		updateType();
		updatePreview();
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
