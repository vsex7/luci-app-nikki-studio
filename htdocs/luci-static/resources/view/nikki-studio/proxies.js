'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var P = ns.P;
var TYPES = [ 'ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'anytls', 'wireguard', 'socks5', 'http', 'snell', 'ssh', 'mieru', 'direct', 'dns' ];
var BASE_KEYS = [ 'name', 'type', 'server', 'port', 'udp' ];

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.content = E('div', {});
		this.delays = {};
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 节点'),
			E('div', { 'class': 'cbi-map-descr' }, '添加自建节点（例如 VPS 上搭建的节点），粘贴分享链接即可导入。添加后可在「策略组」中使用。'),
			ns.renderHeader(session),
			this.content
		]);
	},

	refresh: function() { dom.content(this.content, this.build()); },

	sec: function() { return this.session.currentSection('proxies'); },

	takenNames: function(exceptName) {
		var t = {};
		this.session.policyNames().forEach(function(n) { if (n !== exceptName) t[n] = true; });
		return t;
	},

	build: function() {
		var session = this.session, self = this, sec = this.sec();
		var items = session.items(sec);
		var editable = session.editable(sec);
		var out = [ ns.renderModeTabs(session, 'proxies', function() { self.refresh(); }), ns.lockedNotice(session, sec) ];

		if (sec == 'proxies' && session.isMixin())
			out.push(E('div', { 'class': 'alert-message warning' }, '注意：此列表非空时，订阅中的全部节点都会被替换掉，订阅的策略组若引用了原节点会校验失败。添加自建节点通常应使用「追加节点」。'));

		out.push(E('div', { 'class': 'ns-bar' }, [
			ns.btn('导入分享链接 / 配置', 'cbi-button-add', function() { return self.importDialog(); }),
			ns.btn('手动添加', 'cbi-button-add', function() { return self.editDialog(-1); }),
			E('span', { 'class': 'ns-grow' }),
			items.length ? ns.btn('全部测速', '', function() { return self.testAll(items.map(function(p) { return p.name; })); }, '仅对已保存并在运行中的节点有效') : ''
		]));
		if (!editable) out[out.length - 1] = E('div', {});

		out.push(this.table(items, editable, false));

		if (session.isMixin() && session.source) {
			var src = session.source.proxies || [];
			var rep = session.items('proxies').length > 0;
			out.push(E('div', { 'class': 'cbi-section' }, [
				ns.details('订阅中的节点（' + src.length + ' 个' + (rep ? '，已被「替换」列表取代' : '') + '）', E('div', {}, [
					src.length ? ns.btn('全部测速', '', function() { return self.testAll(src.map(function(p) { return p.name; })); }) : '',
					this.table(src, false, true)
				]))
			]));
		}
		return out;
	},

	delayCell: function(name) {
		var d = this.delays[name];
		if (!d) return '';
		if (d.pending) return E('span', { 'class': 'spinning' }, '');
		if (d.error) return ns.badge(d.error, 'err');
		return ns.badge(d.delay + ' ms', d.delay < 300 ? 'ok' : d.delay < 800 ? 'warn' : 'err');
	},

	testOne: function(name) {
		var self = this;
		this.delays[name] = { pending: true };
		this.refresh();
		return ns.delayTest(name).then(function(r) { self.delays[name] = r; self.refresh(); });
	},

	testAll: function(names) {
		var self = this, queue = names.slice(), running = 0;
		return new Promise(function(resolve) {
			function next() {
				if (!queue.length && !running) return resolve();
				while (running < 4 && queue.length) {
					var n = queue.shift();
					running++;
					self.delays[n] = { pending: true };
					ns.delayTest(n).then(function(nn) { return function(r) { self.delays[nn] = r; running--; self.refresh(); next(); }; }(n));
				}
				self.refresh();
			}
			next();
		});
	},

	table: function(items, editable, readonlySrc) {
		var self = this, session = this.session, sec = this.sec();
		var t = E('table', { 'class': 'table ns-list' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:2em' }, '#'),
				E('th', { 'class': 'th' }, '名称'),
				E('th', { 'class': 'th' }, '类型'),
				E('th', { 'class': 'th' }, '服务器'),
				E('th', { 'class': 'th' }, '延迟'),
				E('th', { 'class': 'th ns-actions' }, '')
			])
		]);
		if (!items.length)
			t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': 6 }, E('em', {}, readonlySrc ? '无' : '暂无节点，点击「导入分享链接」或「手动添加」')) ]));
		items.forEach(function(p, i) {
			p = p || {};
			var acts = [ E('button', { 'class': 'cbi-button', 'click': function() { self.testOne(p.name); } }, '测速') ];
			if (editable) acts = acts.concat([
				E('button', { 'class': 'cbi-button cbi-button-edit', 'click': function() { self.editDialog(i); } }, '编辑'),
				E('button', { 'class': 'cbi-button', 'title': '上移', 'click': function() { if (ns.moveItem(items, i, i - 1)) session.touch(sec); } }, '↑'),
				E('button', { 'class': 'cbi-button', 'title': '下移', 'click': function() { if (ns.moveItem(items, i, i + 1)) session.touch(sec); } }, '↓'),
				E('button', { 'class': 'cbi-button', 'title': '复制', 'click': function() {
					var c = P.clone(p); c.name = P.uniqueName(p.name + ' 副本', self.takenNames());
					items.splice(i + 1, 0, c); session.touch(sec);
				} }, '复制'),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() {
					ns.confirmDelete(session, '节点', p.name).then(function(ok) { if (ok) { items.splice(i, 1); session.touch(sec); } });
				} }, '删除')
			]);
			var tr = E('tr', { 'class': 'tr' + (readonlySrc ? ' ns-src' : '') }, [
				E('td', { 'class': 'td' }, editable ? E('span', { 'class': 'ns-drag', 'title': '拖动排序' }, '≡ ' + (i + 1)) : String(i + 1)),
				E('td', { 'class': 'td' }, p.name || E('em', {}, '（无名称）')),
				E('td', { 'class': 'td' }, p.type || ''),
				E('td', { 'class': 'td' }, (p.server || '') + (p.port ? ':' + p.port : '')),
				E('td', { 'class': 'td' }, self.delayCell(p.name)),
				E('td', { 'class': 'td ns-actions' }, acts)
			]);
			if (editable) ns.makeDraggable(tr, i, function(from, to) { if (ns.moveItem(items, from, to)) session.touch(sec); });
			t.appendChild(tr);
		});
		return t;
	},

	editDialog: function(idx) {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec);
		var p = idx >= 0 ? P.clone(items[idx]) : { name: '', type: 'ss', server: '', port: 443, udp: true };
		var oldName = p.name;
		var rest = {};
		Object.keys(p).forEach(function(k) { if (BASE_KEYS.indexOf(k) < 0) rest[k] = p[k]; });
		var fName = ns.input(p.name), fType = ns.select(p.type, TYPES), fServer = ns.input(p.server), fPort = ns.input(p.port, { type: 'number' });
		var fUdp = ns.checkbox(p.udp, '允许 UDP');
		var fRest = ns.textarea(Object.keys(rest).length ? P.dumpYaml(rest) : '', 12, 'cipher: aes-256-gcm\npassword: "xxxx"');
		var err = E('div', {});
		ui.showModal(idx >= 0 ? '编辑节点' : '添加节点', [
			E('div', { 'class': 'ns-form' }, [
				ns.row('名称', fName, '名称必须唯一，可包含 emoji。'),
				ns.row('类型', fType),
				ns.row('服务器', fServer),
				ns.row('端口', fPort),
				ns.row('', fUdp),
				ns.row('其他参数（YAML）', fRest, '协议相关的其余参数，按 Mihomo 文档填写，例如 cipher、password、uuid、tls、servername、ws-opts、reality-opts 等。')
			]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': ui.createHandlerFn(this, function() {
					var name = fName.value.trim();
					var taken = self.takenNames(oldName);
					if (!name) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '请填写名称'));
					if (taken[name]) return dom.content(err, E('div', { 'class': 'alert-message danger' }, '名称「' + name + '」已被其他节点或策略组使用'));
					var txt = fRest.value.trim();
					return (txt ? ns.yamlToJson(txt) : Promise.resolve({})).then(function(extra) {
						if (extra == null) extra = {};
						if (typeof(extra) != 'object' || Array.isArray(extra)) throw new Error('「其他参数」必须是 键: 值 形式的 YAML');
						var o = { name: name, type: fType.value };
						if (fServer.value.trim()) o.server = fServer.value.trim();
						if (fPort.value !== '') o.port = +fPort.value;
						if (ns.cbOf(fUdp).checked) o.udp = true;
						Object.keys(extra).forEach(function(k) { if (BASE_KEYS.indexOf(k) < 0) o[k] = extra[k]; });
						ui.hideModal();
						if (idx >= 0) items[idx] = o; else items.push(o);
						session.touch(sec);
						if (idx >= 0 && oldName && oldName !== name) {
							var n = ns.cascadeRename(session, oldName, name);
							if (n) ns.notify('已同步更新本文件中 ' + n + ' 处对「' + oldName + '」的引用', 'info');
						}
					}).catch(function(e) { dom.content(err, E('div', { 'class': 'alert-message danger' }, ns.errText(e))); });
				}) }, '确定')
			])
		]);
	},

	importDialog: function() {
		var self = this, session = this.session, sec = this.sec(), items = session.items(sec);
		var ta = ns.textarea('', 10, 'ss://...\nvless://...\nhysteria2://...\n\n也可以粘贴：Base64 订阅内容、WireGuard 配置文件（[Interface]...[Peer]...）、Clash YAML 的 proxies 列表');
		var prefix = ns.input('', { placeholder: '可选，例如：自建-' });
		var err = E('div', {});
		ui.showModal('导入节点', [
			E('div', { 'class': 'ns-form' }, [
				ns.row('内容', ta, '支持 ss、vmess、vless（含 Reality）、trojan、hysteria2/hy2、tuic、anytls、socks5、http 分享链接，每行一个。'),
				ns.row('名称前缀', prefix)
			]),
			err,
			ns.modalButtons([
				ns.closeBtn('取消'),
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': ui.createHandlerFn(this, function() {
					var r = P.parseImport(ta.value);
					var getList = r.yaml ? ns.yamlToJson(ta.value).then(function(v) {
						if (Array.isArray(v)) return v;
						if (v && Array.isArray(v.proxies)) return v.proxies;
						if (v && v.name && v.type) return [ v ];
						throw new Error('YAML 中没有找到节点（需要 proxies 列表或节点对象）');
					}) : Promise.resolve(r.proxies);
					return getList.then(function(list) {
						list = list.filter(function(o) { return o && typeof(o) == 'object' && o.type; });
						if (!list.length) throw new Error('没有可导入的节点' + (r.errors.length ? '：\n' + r.errors.join('\n') : ''));
						var taken = self.takenNames();
						var pf = prefix.value;
						list.forEach(function(o) {
							o.name = P.uniqueName(pf + (o.name || (o.server + ':' + o.port)), taken);
							taken[o.name] = true;
							items.push(o);
						});
						ui.hideModal();
						session.touch(sec);
						ns.notify('已导入 ' + list.length + ' 个节点' + (r.errors.length ? '，' + r.errors.length + ' 行无法识别：' + r.errors.join('；') : ''), r.errors.length ? 'warning' : 'info');
					}).catch(function(e) { dom.content(err, E('div', { 'class': 'alert-message danger', 'style': 'white-space:pre-wrap' }, ns.errText(e))); });
				}) }, '导入')
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
