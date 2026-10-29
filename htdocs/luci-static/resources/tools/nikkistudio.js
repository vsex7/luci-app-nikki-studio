'use strict';
'require baseclass';
'require rpc';
'require ui';
'require dom';
'require tools.nikkistudio_parse as P';

/*
 * Nikki Studio - shared UI core: rpc, session (working copy), toolbar, jobs, dialogs.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

var OBJ = 'luci.nikki-studio';
var callGetState = rpc.declare({ object: OBJ, method: 'get_state', expect: { '': {} } });
var callLoadDoc = rpc.declare({ object: OBJ, method: 'load_doc', params: [ 'target' ], expect: { '': {} } });
var callLoadSource = rpc.declare({ object: OBJ, method: 'load_source', expect: { '': {} } });
var callValidate = rpc.declare({ object: OBJ, method: 'validate', params: [ 'target', 'patch' ], expect: { '': {} } });
var callSave = rpc.declare({ object: OBJ, method: 'save', params: [ 'target', 'base_md5', 'patch', 'job_id', 'restart', 'note' ], expect: { '': {} } });
var callRestore = rpc.declare({ object: OBJ, method: 'restore_backup', params: [ 'name', 'restart' ], expect: { '': {} } });
var callJobStatus = rpc.declare({ object: OBJ, method: 'job_status', params: [ 'job_id' ], expect: { '': {} } });
var callDiff = rpc.declare({ object: OBJ, method: 'diff', params: [ 'target', 'patch' ], expect: { '': {} } });
var callListBackups = rpc.declare({ object: OBJ, method: 'list_backups', params: [ 'target' ], expect: { '': {} } });
var callReadBackup = rpc.declare({ object: OBJ, method: 'read_backup', params: [ 'name' ], expect: { '': {} } });
var callSetMixinFile = rpc.declare({ object: OBJ, method: 'set_mixin_file', params: [ 'enabled' ], expect: { '': {} } });
var callToJson = rpc.declare({ object: OBJ, method: 'to_json', params: [ 'yaml' ], expect: { '': {} } });
var callDelay = rpc.declare({ object: OBJ, method: 'delay', params: [ 'name', 'url', 'timeout' ], expect: { '': {} } });

var LS_TARGET = 'nikki-studio.target';

var STAGES = {
	queued: '排队中', start: '准备中', lock: '获取锁', precheck: '预检查', candidate: '生成候选配置',
	source: '读取订阅/配置来源', overwrite: '应用 Nikki 覆盖选项', merge: '模拟 Nikki 合并（mixin.uc）',
	postprocess: '后处理', nikki_check: 'Nikki 启动检查', references: '检查引用关系', core: 'Mihomo 内核校验',
	backup: '创建备份', write: '写入文件', restart: '重启 Nikki', health: '等待 Nikki 启动并检查健康状态',
	rollback: '启动失败，正在自动回滚', done: '完成'
};

var KINDS = {
	proxies: { title: '节点', prepend: 'nikki-proxies', replace: 'proxies', profile: 'proxies' },
	groups: { title: '策略组', prepend: 'nikki-proxy-groups', replace: 'proxy-groups', profile: 'proxy-groups' },
	rules: { title: '规则', prepend: 'nikki-rules', replace: 'rules', profile: 'rules' },
	providers: { title: '规则集', map: 'rule-providers', profile: 'rule-providers' },
	proxy_providers: { title: '节点池', map: 'proxy-providers', profile: 'proxy-providers' }
};

var MAP_KEYS = { 'rule-providers': true, 'proxy-providers': true };

var SECTION_LABEL = {
	'nikki-proxies': '追加节点（插在订阅节点之前）',
	'proxies': '替换订阅的全部节点',
	'nikki-proxy-groups': '追加策略组（插在订阅策略组之前）',
	'proxy-groups': '替换订阅的全部策略组',
	'nikki-rules': '追加规则（优先于订阅规则）',
	'rules': '替换订阅的全部规则',
	'rule-providers': '规则集（与订阅中的规则集合并）',
	'proxy-providers': '节点池订阅（proxy-providers，动态挂载机场）'
};

var CSS = [
	'.ns-bar{display:flex;flex-wrap:wrap;gap:.5em;align-items:center;margin:.5em 0 1em}',
	'.ns-bar .ns-grow{flex:1}',
	'.ns-badge{display:inline-block;padding:0 .5em;border-radius:3px;font-size:90%;line-height:1.7em;background:#888;color:#fff;margin-right:.3em;white-space:nowrap}',
	'.ns-badge.ok{background:#3a7d44}.ns-badge.warn{background:#c58a00}.ns-badge.err{background:#b5372e}.ns-badge.info{background:#2f6fb0}',
	'.ns-dirty{color:#c58a00;font-weight:bold}',
	'.ns-diff{font-family:monospace;font-size:90%;white-space:pre-wrap;word-break:break-all;max-height:55vh;overflow:auto;border:1px solid #8884;padding:.3em}',
	'.ns-diff div{padding:0 .3em}.ns-diff .add{background:#2e7d3233}.ns-diff .del{background:#c6282833}.ns-diff .hunk{color:#888;font-style:italic}',
	'.ns-pre{font-family:monospace;font-size:90%;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;border:1px solid #8884;padding:.5em}',
	'.ns-list .tr.ns-src{opacity:.75}',
	'.ns-list .td{vertical-align:middle;word-break:break-all}',
	'.ns-actions{white-space:nowrap;text-align:right}',
	'.ns-actions .cbi-button{padding:0 .6em;margin:1px}',
	'.ns-form .ns-row{display:flex;flex-wrap:wrap;align-items:center;margin:.4em 0;gap:.5em}',
	'.ns-form .ns-row > label{min-width:9em;font-weight:bold}',
	'.ns-form .ns-row > .ns-ctl{flex:1;min-width:14em}',
	'.ns-form input[type=text],.ns-form input[type=number],.ns-form select,.ns-form textarea{width:100%;box-sizing:border-box}',
	'.ns-form textarea{font-family:monospace;min-height:8em}',
	'.ns-help{color:#888;font-size:90%;margin:.2em 0}',
	'.ns-members{border:1px solid #8884;max-height:14em;overflow:auto;padding:.2em}',
	'.ns-members div{display:flex;align-items:center;gap:.3em;padding:1px .2em}',
	'.ns-members div span{flex:1;word-break:break-all}',
	'.ns-members div:hover{background:#8882}',
	'.ns-tabs{display:flex;gap:.3em;flex-wrap:wrap;margin:.5em 0}',
	'.ns-tabs .cbi-button.active{font-weight:bold;outline:2px solid #2f6fb0}',
	'.ns-pager{display:flex;gap:.5em;align-items:center;justify-content:flex-end;margin:.5em 0}',
	'.ns-drag{cursor:move;user-select:none;color:#888;padding:0 .3em;white-space:nowrap}',
	'.ns-bar input[type=text]{width:100%;box-sizing:border-box}',
	'.ns-tr-over{outline:2px dashed #2f6fb0}',
	'.ns-kv{display:grid;grid-template-columns:max-content 1fr;gap:.3em 1em}',
	'.ns-kv > :nth-child(odd){font-weight:bold}'
].join('\n');

function injectCss() {
	if (document.getElementById('nikki-studio-css')) return;
	var s = E('style', { id: 'nikki-studio-css' }, CSS);
	document.head.appendChild(s);
}

function lsGet(k, d) { try { var v = window.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

function errText(e) {
	if (e == null) return '未知错误';
	if (typeof(e) == 'string') return e;
	if (e.message) return e.message;
	if (e.error) return e.error + (e.detail ? '：' + e.detail : '');
	return String(e);
}

function notify(msg, kind) {
	ui.addNotification(null, E('p', {}, msg), kind || 'info');
}

function btn(label, cls, fn, title) {
	return E('button', { 'class': 'cbi-button ' + (cls || ''), 'title': title || '', 'click': ui.createHandlerFn(this, fn) }, label);
}

function badge(text, cls) { return E('span', { 'class': 'ns-badge ' + (cls || '') }, text); }

function closeBtn(label, fn) {
	return E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); if (fn) fn(); } }, label || '关闭');
}

function modalButtons(list) {
	var out = [];
	list.forEach(function(b, i) { if (i) out.push(' '); out.push(b); });
	return E('div', { 'class': 'right' }, out);
}

function confirmDialog(title, body, okLabel, danger) {
	return new Promise(function(resolve) {
		ui.showModal(title, [
			(typeof(body) == 'string') ? E('p', {}, body) : body,
			modalButtons([
				E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); resolve(false); } }, '取消'),
				E('button', { 'class': 'cbi-button ' + (danger ? 'cbi-button-negative' : 'cbi-button-positive'), 'click': function() { ui.hideModal(); resolve(true); } }, okLabel || '确定')
			])
		]);
	});
}

function alertDialog(title, body) {
	return new Promise(function(resolve) {
		ui.showModal(title, [ (typeof(body) == 'string') ? E('p', {}, body) : body, modalButtons([ closeBtn('确定', resolve) ]) ]);
	});
}

function sleep(ms) { return new Promise(function(r) { window.setTimeout(r, ms); }); }

/* Form helpers ---------------------------------------------------- */

function row(label, ctl, help) {
	return E('div', { 'class': 'ns-row' }, [
		E('label', {}, label),
		E('div', { 'class': 'ns-ctl' }, [ ctl, help ? E('div', { 'class': 'ns-help' }, help) : '' ])
	]);
}

function input(value, opts) {
	opts = opts || {};
	return E('input', { 'type': opts.type || 'text', 'class': 'cbi-input-text', 'value': value == null ? '' : value, 'placeholder': opts.placeholder || '', 'id': opts.id || null });
}

function select(value, choices, opts) {
	opts = opts || {};
	var sel = E('select', { 'class': 'cbi-input-select', 'id': opts.id || null });
	var found = false;
	choices.forEach(function(c) {
		var v = Array.isArray(c) ? c[0] : c, l = Array.isArray(c) ? c[1] : c;
		var o = E('option', { 'value': v }, l);
		if (String(v) === String(value == null ? '' : value)) { o.selected = true; found = true; }
		sel.appendChild(o);
	});
	if (!found && value != null && value !== '') {
		var o = E('option', { 'value': value, 'selected': 'selected' }, value);
		sel.insertBefore(o, sel.firstChild);
	}
	return sel;
}

function checkbox(checked, label) {
	var cb = E('input', { 'type': 'checkbox' });
	cb.checked = !!checked;
	return label ? E('label', { 'style': 'font-weight:normal;margin-right:1em' }, [ cb, ' ', label ]) : cb;
}

function cbOf(node) { return node.tagName == 'INPUT' ? node : node.querySelector('input'); }

function textarea(value, rows, placeholder) {
	var t = E('textarea', { 'rows': rows || 8, 'placeholder': placeholder || '', 'spellcheck': 'false' });
	t.value = value == null ? '' : value;
	return t;
}

/* Ordered member editor: returns { node, getValue() } */
function memberEditor(values, choiceGroups) {
	var cur = (values || []).slice();
	var list = E('div', { 'class': 'ns-members' });
	var search = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '搜索并添加…' });
	var sel = E('select', { 'multiple': 'multiple', 'size': 6, 'style': 'width:100%' });

	function renderSel() {
		var q = search.value.trim().toLowerCase();
		dom.content(sel, []);
		choiceGroups.forEach(function(g) {
			var og = E('optgroup', { 'label': g.label });
			g.items.forEach(function(n) {
				if (cur.indexOf(n) >= 0) return;
				if (q && n.toLowerCase().indexOf(q) < 0) return;
				og.appendChild(E('option', { 'value': n }, n));
			});
			if (og.childNodes.length) sel.appendChild(og);
		});
	}
	function renderList() {
		dom.content(list, cur.length ? cur.map(function(n, i) {
			return E('div', {}, [
				E('span', {}, (i + 1) + '. ' + n),
				E('button', { 'class': 'cbi-button', 'title': '上移', 'click': function(ev) { ev.preventDefault(); if (i > 0) { cur.splice(i - 1, 0, cur.splice(i, 1)[0]); renderList(); } } }, '↑'),
				E('button', { 'class': 'cbi-button', 'title': '下移', 'click': function(ev) { ev.preventDefault(); if (i < cur.length - 1) { cur.splice(i + 1, 0, cur.splice(i, 1)[0]); renderList(); } } }, '↓'),
				E('button', { 'class': 'cbi-button cbi-button-negative', 'title': '移除', 'click': function(ev) { ev.preventDefault(); cur.splice(i, 1); renderList(); renderSel(); } }, '×')
			]);
		}) : E('em', { 'style': 'color:#888' }, '（暂无成员）'));
	}
	function addSelected() {
		Array.prototype.forEach.call(sel.selectedOptions, function(o) { if (cur.indexOf(o.value) < 0) cur.push(o.value); });
		var custom = search.value.trim();
		if (!sel.selectedOptions.length && custom) {
			var first = sel.querySelector('option');
			if (first) cur.push(first.value);
			else if (cur.indexOf(custom) < 0) cur.push(custom);
		}
		search.value = '';
		renderList(); renderSel();
	}
	search.addEventListener('input', renderSel);
	search.addEventListener('keydown', function(ev) { if (ev.key == 'Enter') { ev.preventDefault(); addSelected(); } });
	sel.addEventListener('dblclick', addSelected);
	renderSel(); renderList();
	return {
		node: E('div', {}, [ list, E('div', { 'style': 'margin-top:.3em' }, [ search ]), sel,
			E('button', { 'class': 'cbi-button cbi-button-add', 'click': function(ev) { ev.preventDefault(); addSelected(); } }, '添加选中项'),
			E('div', { 'class': 'ns-help' }, '双击或选中后点击「添加」；可多选（Ctrl/Shift）。在搜索框中按回车会添加第一个匹配项；没有匹配时添加输入的名称。顺序即策略组中的显示顺序，第一项为默认选择。') ]),
		getValue: function() { return cur.slice(); }
	};
}

/* YAML text -> JSON via backend */
function yamlToJson(text) {
	return callToJson(text).then(function(r) {
		if (r.error) throw new Error(r.error == 'PARSE_FAILED' ? ('YAML 格式错误：' + (r.detail || '')) : r.error);
		return r.value;
	});
}

/* ---------------------------------------------------------------- */
/* Session                                                          */
/* ---------------------------------------------------------------- */

var Session = baseclass.extend({
	__init__: function(state, doc, source, target) {
		this.state = state;
		this.target = target;
		this.source = source;
		this.listeners = [];
		this.setDoc(doc);
	},

	setDoc: function(doc) {
		this.doc = doc;
		this.work = {};
		this.dirty = {};
		this.lastValidate = null;
		var secs = doc.sections || {};
		for (var k in secs) this.work[k] = P.clone(secs[k].items);
	},

	isMixin: function() { return this.target == 'mixin'; },
	targetLabel: function() { return this.isMixin() ? '混入文件 mixin.yaml' : ('配置文件 ' + this.target.substring(8)); },
	section: function(k) { return (this.doc.sections || {})[k] || { present: false, readonly: false, locked: false, items: [] }; },
	items: function(k) { if (this.work[k] == null) this.work[k] = MAP_KEYS[k] ? {} : []; return this.work[k]; },

	/* map sections (rule-providers / proxy-providers) */
	map: function(k) {
		var v = this.items(k);
		if (v == null || typeof(v) != 'object' || Array.isArray(v)) { v = {}; this.work[k] = v; }
		return v;
	},
	setMapEntry: function(k, name, value, oldName) {
		var m = this.map(k);
		if (oldName && oldName !== name) delete m[oldName];
		m[name] = value;
		this.touch(k);
	},
	deleteMapEntry: function(k, name) {
		var m = this.map(k);
		delete m[name];
		this.touch(k);
	},

	setItems: function(k, v) {
		this.work[k] = v;
		this.dirty[k] = JSON.stringify(v) !== JSON.stringify(this.section(k).items);
		if (!this.dirty[k]) delete this.dirty[k];
		this.lastValidate = null;
		this.emit();
	},

	touch: function(k) { this.setItems(k, this.work[k]); },
	isDirty: function() { return Object.keys(this.dirty).length > 0; },
	onChange: function(fn) { this.listeners.push(fn); },
	emit: function() { this.listeners.forEach(function(fn) { try { fn(); } catch (e) { console.error(e); } }); },

	patch: function() {
		var p = {};
		for (var k in this.dirty) p[k] = this.work[k];
		return p;
	},

	/* section key used for page kind & selected mode */
	sectionsFor: function(kind) {
		var K = KINDS[kind];
		if (!this.isMixin()) return [ K.profile ];
		if (K.map) return [ K.map ];
		return [ K.prepend, K.replace ];
	},

	currentSection: function(kind) {
		var secs = this.sectionsFor(kind);
		if (secs.length == 1) return secs[0];
		var saved = lsGet('nikki-studio.mode.' + kind, null);
		if (saved && secs.indexOf(saved) >= 0) return saved;
		var rep = this.items(secs[1]);
		return (rep && rep.length && !this.items(secs[0]).length) ? secs[1] : secs[0];
	},

	setCurrentSection: function(kind, sec) { lsSet('nikki-studio.mode.' + kind, sec); },

	editable: function(k) { return !this.section(k).locked; },

	/* Effective list as Nikki would build it (mixin target): [{v, origin, index}] */
	effective: function(kind) {
		var K = KINDS[kind], self = this, out = [];
		var srcKey = { proxies: 'proxies', groups: 'groups', rules: 'rules' }[kind];
		if (!this.isMixin()) {
			this.items(K.profile).forEach(function(v, i) { out.push({ v: v, origin: K.profile, index: i }); });
			return out;
		}
		var pre = this.items(K.prepend);
		if (kind == 'rules' && this.state.luci_rules) {
			this.state.luci_rules.forEach(function(v) { out.push({ v: v, origin: 'luci' }); });
		}
		else pre.forEach(function(v, i) { out.push({ v: v, origin: K.prepend, index: i }); });
		var rep = this.items(K.replace);
		if (rep.length) rep.forEach(function(v, i) { out.push({ v: v, origin: K.replace, index: i }); });
		else ((this.source || {})[srcKey] || []).forEach(function(v, i) { out.push({ v: v, origin: 'source', index: i }); });
		return out;
	},

	proxyList: function() {
		return this.effective('proxies').map(function(e) { return { name: e.v && e.v.name, type: e.v && e.v.type }; }).filter(function(p) { return p.name; });
	},

	groupNames: function() { return this.effective('groups').map(function(e) { return e.v && e.v.name; }).filter(function(n) { return n; }); },
	proxyNames: function() { return this.proxyList().map(function(p) { return p.name; }); },

	policyChoices: function(excludeName) {
		var groups = this.groupNames().filter(function(n) { return n != excludeName; });
		return [
			{ label: '策略组', items: groups },
			{ label: '节点', items: this.proxyNames() },
			{ label: '内置', items: P.BUILTIN_POLICIES }
		];
	},

	policyNames: function() { return this.groupNames().concat(this.proxyNames(), P.BUILTIN_POLICIES); },

	ruleSetNames: function() {
		var names = {};
		var add = function(n) { names[n] = true; };
		if (this.isMixin()) ((this.source || {}).rule_providers || []).forEach(add);
		Object.keys(this.items('rule-providers') || {}).forEach(add);
		(this.state.luci_rule_providers || []).forEach(add);
		return Object.keys(names);
	},

	proxyProviderNames: function() {
		var fromSrc = (this.source || {}).proxy_providers || [];
		var fromDoc = Object.keys(this.map('proxy-providers') || {});
		var set = {};
		fromSrc.concat(fromDoc).forEach(function(k) { if (k) set[k] = true; });
		return Object.keys(set);
	},
	subRuleNames: function() { return (this.source || {}).sub_rules || []; },

	reload: function() {
		var self = this;
		return Promise.all([ callGetState(), callLoadDoc(this.target), callLoadSource() ]).then(function(r) {
			if (r[1].error) throw new Error('读取编辑目标失败：' + errText(r[1]));
			self.state = r[0];
			self.source = r[2].error ? null : r[2];
			self.sourceError = r[2].error ? r[2] : null;
			self.setDoc(r[1]);
			self.emit();
		});
	}
});

function availableTargets(state) {
	var t = [ [ 'mixin', '混入文件 mixin.yaml（推荐）' ] ];
	(state.profiles || []).forEach(function(p) { t.push([ 'profile:' + p, '配置文件 ' + p ]); });
	return t;
}

function load() {
	injectCss();
	return callGetState().then(function(state) {
		var target = lsGet(LS_TARGET, 'mixin');
		if (!availableTargets(state).some(function(t) { return t[0] == target; })) target = 'mixin';
		return Promise.all([ callLoadDoc(target), callLoadSource() ]).then(function(r) {
			if (r[0].error) throw new Error('读取编辑目标失败：' + errText(r[0]));
			var s = new Session(state, r[0], r[1].error ? null : r[1], target);
			s.sourceError = r[1].error ? r[1] : null;
			installGuard(s);
			return s;
		});
	});
}

var guardSession = null;
function installGuard(s) {
	guardSession = s;
	if (window.__nikkiStudioGuard) return;
	window.__nikkiStudioGuard = true;
	window.addEventListener('beforeunload', function(ev) {
		if (guardSession && guardSession.isDirty()) { ev.preventDefault(); ev.returnValue = ''; return ''; }
	});
}

/* ---------------------------------------------------------------- */
/* Jobs & results                                                   */
/* ---------------------------------------------------------------- */

function runJob(title, start) {
	var stageEl = E('span', {}, STAGES.queued);
	var timeEl = E('span', { 'style': 'color:#888' }, '');
	var t0 = Date.now();
	ui.showModal(title, [ E('p', { 'class': 'spinning' }, [ stageEl, ' ', timeEl ]),
		E('p', { 'class': 'ns-help' }, '任务在路由器后台执行，关闭页面不会中断。重启 Nikki 并检查健康状态最长可能需要 1～3 分钟。') ]);
	var failures = 0;
	function poll(id) {
		return callJobStatus(id).then(function(st) {
			failures = 0;
			if (st.error) throw new Error('查询任务状态失败：' + st.error);
			stageEl.textContent = STAGES[st.stage] || st.stage || '';
			timeEl.textContent = '（' + Math.round((Date.now() - t0) / 1000) + ' 秒）';
			if (st.state == 'done') return st.result || { ok: false, message: '任务没有返回结果' };
			return sleep(1000).then(function() { return poll(id); });
		}, function(err) {
			if (++failures > 15) throw err;
			return sleep(2000).then(function() { return poll(id); });
		});
	}
	return Promise.resolve(start).then(function(r) {
		if (r.error) throw new Error(r.message || r.error);
		return poll(r.job_id).then(function(res) { res.job_id = r.job_id; return res; });
	}).then(function(res) { ui.hideModal(); return res; }, function(err) { ui.hideModal(); throw err; });
}

function msgList(title, items, cls) {
	if (!items || !items.length) return '';
	return E('div', { 'class': 'alert-message ' + (cls || '') }, [
		E('strong', {}, title + '（' + items.length + '）'),
		E('ul', {}, items.slice(0, 100).map(function(x) { return E('li', {}, x.msg || x.message || String(x)); }))
	]);
}

function details(summary, content) {
	return E('details', { 'style': 'margin:.5em 0' }, [ E('summary', { 'style': 'cursor:pointer' }, summary), content ]);
}

function pre(text) { return E('div', { 'class': 'ns-pre' }, text); }

function resultBody(res) {
	var parts = [];
	var stage = STAGES[res.stage] || res.stage;
	parts.push(E('p', {}, [ badge(res.ok ? '成功' : '失败', res.ok ? 'ok' : 'err'), ' ', res.message || '' ]));
	if (!res.ok && stage && res.stage != 'done') parts.push(E('p', { 'class': 'ns-help' }, '失败阶段：' + stage));
	if (res.stats) parts.push(E('p', {}, '合并后：' + res.stats.proxies + ' 个节点，' + res.stats.groups + ' 个策略组，' + res.stats.rules + ' 条规则'));
	if (res.validation && res.validation.stats) {
		var s = res.validation.stats;
		parts.push(E('p', {}, '合并后：' + s.proxies + ' 个节点，' + s.groups + ' 个策略组，' + s.rules + ' 条规则'));
	}
	parts.push(msgList('错误', res.errors, 'danger'));
	parts.push(msgList('提示', res.warnings || (res.validation && res.validation.warnings), 'warning'));
	var note = res.source_note || (res.validation && res.validation.source_note);
	if (note) parts.push(E('div', { 'class': 'alert-message notice' }, note));
	if (res.backup) parts.push(E('p', { 'class': 'ns-help' }, '保存前的版本已备份为：' + res.backup));
	if (res.failed_backup) parts.push(E('p', { 'class': 'ns-help' }, '启动失败的版本已另存为：' + res.failed_backup + '（可在「备份与恢复」中查看）'));
	if (res.health && res.health.message && !res.health.ok) parts.push(E('p', {}, '启动检查：' + res.health.message));
	if (res.health && res.health.log && res.health.log.length) parts.push(details('Nikki 启动日志', pre(res.health.log.join('\n'))));
	if (res.core_log && res.core_log.length) parts.push(details('内核日志（最后 50 行）', pre(res.core_log.join('\n'))));
	if (res.core_output) parts.push(details('Mihomo 校验输出', pre(res.core_output)));
	return E('div', {}, parts);
}

function showResult(session, title, res) {
	var buttons = [];
	if (res.code == 'CONFLICT')
		buttons.push(E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { ui.hideModal(); doReload(session, true); } }, '放弃修改并重新加载'));
	if (res.code == 'MIXIN_DISABLED')
		buttons.push(E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
			ui.hideModal();
			callSetMixinFile(true).then(function(r) {
				if (r.success) { notify('已开启 Nikki 的「混入文件」选项', 'info'); session.state.nikki.mixin_file_content = true; session.emit(); }
				else notify('开启失败', 'danger');
			});
		} }, '一键开启混入文件'));
	buttons.push(closeBtn('关闭'));
	ui.showModal(title, [ resultBody(res), modalButtons(buttons) ]);
}

/* ---------------------------------------------------------------- */
/* Diff                                                             */
/* ---------------------------------------------------------------- */

function renderDiff(before, after) {
	var h = P.diffHunks(P.diffLines(before || '', after || ''), 3);
	if (!h.changed) return { node: E('p', {}, '没有任何改动。'), changed: 0 };
	return {
		changed: h.changed,
		node: E('div', { 'class': 'ns-diff' }, h.lines.map(function(o) {
			var cls = o[0] == '+' ? 'add' : o[0] == '-' ? 'del' : o[0] == '@' ? 'hunk' : '';
			return E('div', { 'class': cls }, (o[0] == '@' ? '' : o[0] + ' ') + o[1]);
		}))
	};
}

function fetchDiff(session) {
	return callDiff(session.target, session.patch()).then(function(r) {
		if (r.error) throw new Error('生成差异失败：' + r.error + (r.detail ? ' ' + r.detail : ''));
		return r;
	});
}

/* ---------------------------------------------------------------- */
/* Toolbar actions                                                  */
/* ---------------------------------------------------------------- */

function doReload(session, force) {
	var go = function() {
		return session.reload().then(function() { notify('已重新加载', 'info'); }, function(e) { notify(errText(e), 'danger'); });
	};
	if (!force && session.isDirty())
		return confirmDialog('重新加载', '有未保存的修改，重新加载将丢弃这些修改。确定继续？', '丢弃并重新加载', true).then(function(ok) { if (ok) return go(); });
	return go();
}

function doValidate(session) {
	var patch = session.patch();
	return runJob('正在校验…', callValidate(session.target, patch)).then(function(res) {
		if (res.ok) session.lastValidate = { job_id: res.job_id, key: JSON.stringify(patch) };
		showResult(session, res.ok ? '校验通过' : '校验未通过', res);
		return res;
	}, function(e) { notify('校验失败：' + errText(e), 'danger'); });
}

function doShowDiff(session) {
	return fetchDiff(session).then(function(r) {
		var d = renderDiff(r.before, r.after);
		ui.showModal('查看差异：' + session.targetLabel(), [ d.node, modalButtons([ closeBtn('关闭') ]) ]);
	}, function(e) { notify(errText(e), 'danger'); });
}

function doSave(session, restart) {
	if (!session.isDirty()) {
		if (!restart) { notify('没有需要保存的修改', 'info'); return Promise.resolve(); }
	}
	var patch = session.patch();
	return fetchDiff(session).then(function(r) {
		var d = renderDiff(r.before, r.after);
		var note = input('', { placeholder: '备注（可选），例如：添加 OpenCode 分组' });
		note.style.width = '100%';
		return new Promise(function(resolve) {
			ui.showModal(restart ? '保存并重启 Nikki' : '保存', [
				E('p', {}, [ '将写入：', E('code', {}, session.doc.path), d.changed ? '，改动 ' + d.changed + ' 行' : '' ]),
				d.node,
				E('div', { 'style': 'margin:.8em 0' }, [ note ]),
				E('p', { 'class': 'ns-help' }, restart
					? '保存前会先完整校验；保存后重启 Nikki，若启动失败会自动恢复到保存前的版本。'
					: '保存前会先完整校验。修改需要重启 Nikki 才会生效。'),
				modalButtons([
					E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); resolve(null); } }, '取消'),
					E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() { ui.hideModal(); resolve(note.value); } }, restart ? '保存并重启' : '保存')
				])
			]);
		});
	}).then(function(noteText) {
		if (noteText == null) return;
		var reuse = (session.lastValidate && session.lastValidate.key == JSON.stringify(patch)) ? session.lastValidate.job_id : '';
		return runJob(restart ? '正在保存并重启…' : '正在保存…', callSave(session.target, session.doc.md5 || '', patch, reuse, !!restart, noteText)).then(function(res) {
			var after = (res.ok || res.rolled_back) ? session.reload() : Promise.resolve();
			return after.then(function() {
				showResult(session, res.ok ? '保存成功' : (res.rolled_back ? '启动失败，已自动回滚' : '保存失败'), res);
			}, function() { showResult(session, res.ok ? '保存成功' : '保存失败', res); });
		});
	}).catch(function(e) { notify(errText(e), 'danger'); });
}

/* ---------------------------------------------------------------- */
/* Header / toolbar                                                 */
/* ---------------------------------------------------------------- */

function renderHeader(session, opts) {
	opts = opts || {};
	var wrap = E('div', {});
	function build() {
		var st = session.state, n = st.nikki || {};
		var tsel = select(session.target, availableTargets(st));
		tsel.addEventListener('change', function() {
			var nt = tsel.value;
			var go = function() {
				lsSet(LS_TARGET, nt);
				session.target = nt;
				return session.reload().catch(function(e) { notify(errText(e), 'danger'); });
			};
			if (session.isDirty())
				confirmDialog('切换编辑目标', '当前有未保存的修改，切换后将丢弃。确定继续？', '丢弃并切换', true).then(function(ok) { if (ok) go(); else tsel.value = session.target; });
			else go();
		});
		var badges = [
			st.running ? badge('Nikki 运行中', 'ok') : badge('Nikki 未运行', n.enabled ? 'err' : ''),
			session.isMixin() && !n.mixin_file_content ? badge('混入文件未启用', 'err') : '',
			session.isDirty() ? E('span', { 'class': 'ns-dirty' }, '● 有未保存的修改') : ''
		];
		var bar = E('div', { 'class': 'ns-bar' }, [
			E('span', {}, '编辑目标：'), tsel,
			E('span', { 'class': 'ns-grow' }, badges),
			btn('重新加载', '', function() { return doReload(session); }),
			btn('校验', 'cbi-button-action', function() { return doValidate(session); }, '模拟 Nikki 启动流程并用 Mihomo 内核校验'),
			btn('查看差异', '', function() { return doShowDiff(session); }),
			btn('保存', 'cbi-button-save', function() { return doSave(session, false); }),
			btn('保存并重启', 'cbi-button-apply', function() { return doSave(session, true); })
		]);
		var notes = [];
		if (session.doc.warnings && session.doc.warnings.length) {
			session.doc.warnings.forEach(function(w) {
				if (w.code == 'ANCHOR_LOCKED')
					notes.push(E('div', { 'class': 'alert-message warning' }, '「' + w.section + '」中定义的 YAML 锚点被文件其他位置引用，为避免破坏文件，该部分只能查看不能编辑。'));
				else if (w.code == 'ANCHOR_IN_SECTION')
					notes.push(E('div', { 'class': 'alert-message notice' }, '「' + w.section + '」使用了 YAML 锚点/别名，修改该部分后保存时会被展开为普通内容（注释也会保留在原处之外的部分）。'));
				else if (w.code == 'BAD_SECTION_TYPE')
					notes.push(E('div', { 'class': 'alert-message warning' }, '「' + w.section + '」的格式不正确（类型错误），保存时会被替换。'));
			});
		}
		if (session.isMixin() && session.sourceError && opts.needSource !== false) {
			var se = session.sourceError;
			notes.push(E('div', { 'class': 'alert-message notice' },
				se.error == 'SOURCE_MISSING' ? '当前订阅/配置文件尚未下载或不存在，无法显示订阅中的内容。'
					: se.error == 'PARSE_FAILED' ? '无法解析当前订阅/配置文件：' + (se.detail || '')
					: '未能读取 Nikki 当前使用的订阅/配置文件（' + se.error + '）'));
		}
		dom.content(wrap, [ bar ].concat(notes));
	}
	build();
	session.onChange(build);
	return wrap;
}

/* Mode tabs for mixin prepend/replace */
function renderModeTabs(session, kind, onChange) {
	var secs = session.sectionsFor(kind);
	if (secs.length < 2) return E('div', {});
	var cur = session.currentSection(kind);
	var K = KINDS[kind];
	var tabs = E('div', { 'class': 'ns-tabs' }, secs.map(function(s) {
		var count = session.items(s).length;
		return E('button', { 'class': 'cbi-button' + (s == cur ? ' active' : ''), 'click': function(ev) {
			ev.preventDefault();
			session.setCurrentSection(kind, s);
			onChange(s);
		} }, SECTION_LABEL[s] + (count ? '（' + count + '）' : ''));
	}));
	var help = (cur == K.prepend)
		? '写入 mixin.yaml 的「' + cur + '」，Nikki 启动时插在订阅内容前面。订阅更新不影响这里的内容。'
		: '写入 mixin.yaml 的「' + cur + '」，Nikki 启动时会用它整体替换订阅中的「' + cur + '」。列表为空则不替换。';
	return E('div', {}, [ tabs, E('div', { 'class': 'ns-help' }, help) ]);
}

function originLabel(origin) {
	return {
		'source': '订阅', 'luci': 'LuCI 规则', 'nikki-proxies': '追加', 'nikki-proxy-groups': '追加', 'nikki-rules': '追加',
		'proxies': '替换', 'proxy-groups': '替换', 'rules': '替换', 'rule-providers': '本文件'
	}[origin] || origin;
}

/* Generic list ops on a section */
function moveItem(arr, from, to) {
	if (to < 0 || to >= arr.length || from == to) return false;
	arr.splice(to, 0, arr.splice(from, 1)[0]);
	return true;
}

/* Rename cascade within the edited document (all list sections). */
function cascadeRename(session, from, to) {
	if (!from || from === to) return 0;
	var n = 0;
	[ 'proxy-groups', 'nikki-proxy-groups' ].forEach(function(k) {
		if (session.work[k] && session.editable(k)) { var c = P.renameInGroups(session.work[k], from, to); if (c) { n += c; session.touch(k); } }
	});
	[ 'rules', 'nikki-rules' ].forEach(function(k) {
		if (session.work[k] && session.editable(k)) { var c = P.renameInRules(session.work[k], from, to); if (c) { n += c; session.touch(k); } }
	});
	return n;
}

function referencesInDoc(session, name) {
	var groups = [], rules = 0;
	[ 'proxy-groups', 'nikki-proxy-groups' ].forEach(function(k) { var r = P.referencesTo(name, session.work[k] || [], []); groups = groups.concat(r.groups); });
	[ 'rules', 'nikki-rules' ].forEach(function(k) { rules += P.referencesTo(name, [], session.work[k] || []).rules; });
	var srcRefs = { groups: [], rules: 0 };
	if (session.isMixin() && session.source) srcRefs = P.referencesTo(name, session.source.groups || [], session.source.rules || []);
	return { groups: groups, rules: rules, srcGroups: srcRefs.groups, srcRules: srcRefs.rules };
}

function removeReferences(session, name) {
	[ 'proxy-groups', 'nikki-proxy-groups' ].forEach(function(k) {
		var arr = session.work[k];
		if (!arr || !session.editable(k)) return;
		var ch = false;
		arr.forEach(function(g) { if (Array.isArray(g.proxies) && g.proxies.indexOf(name) >= 0) { g.proxies = g.proxies.filter(function(x) { return x !== name; }); ch = true; } });
		if (ch) session.touch(k);
	});
}

/* Delete with reference warning */
function confirmDelete(session, what, name) {
	var refs = referencesInDoc(session, name);
	var lines = [];
	if (refs.groups.length) lines.push('本文件中被这些策略组引用：' + refs.groups.join('、'));
	if (refs.rules) lines.push('本文件中有 ' + refs.rules + ' 条规则指向它');
	if (refs.srcGroups.length) lines.push('订阅中被这些策略组引用：' + refs.srcGroups.join('、'));
	if (refs.srcRules) lines.push('订阅中有 ' + refs.srcRules + ' 条规则指向它');
	var cb = checkbox(true, '同时从本文件的策略组成员中移除');
	var body = E('div', {}, [ E('p', {}, '确定删除' + what + '「' + name + '」？'),
		lines.length ? E('div', { 'class': 'alert-message warning' }, [ E('ul', {}, lines.map(function(l) { return E('li', {}, l); })), E('p', {}, '指向它的规则需要手动修改，否则校验会失败。') ]) : '',
		refs.groups.length ? cb : '' ]);
	return confirmDialog('删除' + what, body, '删除', true).then(function(ok) {
		if (ok && refs.groups.length && cbOf(cb).checked) removeReferences(session, name);
		return ok;
	});
}

function delayTest(name, url) {
	return callDelay(P.encodeName(name), P.encodeName(url || 'https://www.gstatic.com/generate_204'), 5000).then(function(r) {
		if (r.error == 'API_NOT_CONFIGURED') return { error: '未配置 external-controller' };
		if (r.error == 'API_UNREACHABLE') return { error: 'Nikki 未运行或 API 不可达' };
		if (r.error) return { error: r.error };
		if (r.delay != null) return { delay: r.delay };
		return { error: r.message || '超时' };
	}, function(e) { return { error: errText(e) }; });
}

function pager(total, page, size, onPage) {
	var pages = Math.max(1, Math.ceil(total / size));
	if (pages <= 1) return E('div', {});
	return E('div', { 'class': 'ns-pager' }, [
		E('span', {}, '共 ' + total + ' 条，第 ' + (page + 1) + '/' + pages + ' 页'),
		E('button', { 'class': 'cbi-button', 'disabled': page <= 0 ? '' : null, 'click': function() { onPage(0); } }, '«'),
		E('button', { 'class': 'cbi-button', 'disabled': page <= 0 ? '' : null, 'click': function() { onPage(page - 1); } }, '‹'),
		E('button', { 'class': 'cbi-button', 'disabled': page >= pages - 1 ? '' : null, 'click': function() { onPage(page + 1); } }, '›'),
		E('button', { 'class': 'cbi-button', 'disabled': page >= pages - 1 ? '' : null, 'click': function() { onPage(pages - 1); } }, '»')
	]);
}

/* Drag & drop row reordering inside a table body. rows have data-idx. */
function makeDraggable(tr, idx, onMove) {
	tr.setAttribute('draggable', 'true');
	tr.addEventListener('dragstart', function(ev) { ev.dataTransfer.setData('text/plain', String(idx)); ev.dataTransfer.effectAllowed = 'move'; });
	tr.addEventListener('dragover', function(ev) { ev.preventDefault(); tr.classList.add('ns-tr-over'); });
	tr.addEventListener('dragleave', function() { tr.classList.remove('ns-tr-over'); });
	tr.addEventListener('drop', function(ev) {
		ev.preventDefault();
		tr.classList.remove('ns-tr-over');
		var from = parseInt(ev.dataTransfer.getData('text/plain'), 10);
		if (!isNaN(from) && from != idx) onMove(from, idx);
	});
}

function lockedNotice(session, sec) {
	if (!session.section(sec).locked) return '';
	return E('div', { 'class': 'alert-message warning' }, '该部分包含被其他位置引用的 YAML 锚点，只能查看，不能编辑。');
}

return baseclass.extend({
	P: P,
	KINDS: KINDS,
	STAGES: STAGES,
	SECTION_LABEL: SECTION_LABEL,
	load: load,
	Session: Session,
	callGetState: callGetState,
	callLoadSource: callLoadSource,
	callListBackups: callListBackups,
	callReadBackup: callReadBackup,
	callRestore: callRestore,
	callSetMixinFile: callSetMixinFile,
	runJob: runJob,
	showResult: showResult,
	resultBody: resultBody,
	renderHeader: renderHeader,
	renderModeTabs: renderModeTabs,
	renderDiff: renderDiff,
	originLabel: originLabel,
	moveItem: moveItem,
	cascadeRename: cascadeRename,
	referencesInDoc: referencesInDoc,
	confirmDelete: confirmDelete,
	confirmDialog: confirmDialog,
	alertDialog: alertDialog,
	notify: notify,
	errText: errText,
	btn: btn,
	badge: badge,
	closeBtn: closeBtn,
	modalButtons: modalButtons,
	row: row,
	input: input,
	select: select,
	checkbox: checkbox,
	cbOf: cbOf,
	textarea: textarea,
	memberEditor: memberEditor,
	yamlToJson: yamlToJson,
	delayTest: delayTest,
	pager: pager,
	makeDraggable: makeDraggable,
	lockedNotice: lockedNotice,
	details: details,
	pre: pre,
	lsGet: lsGet,
	lsSet: lsSet,
	doSave: doSave,
	doValidate: doValidate
});
