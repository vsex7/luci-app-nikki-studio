'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var SOURCE_LABEL = { 'save': '保存前', 'restore': '恢复前', 'auto-rollback': '启动失败的版本' };

function fmtTime(t) {
	var d = new Date(t * 1000);
	var p = function(n) { return (n < 10 ? '0' : '') + n; };
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtSize(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

function targetLabel(t) { return t == 'mixin' ? 'mixin.yaml' : String(t).replace(/^profile:/, ''); }

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.all = ns.lsGet('nikki-studio.backup.all', '0') == '1';
		this.content = E('div', {});
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 备份与恢复'),
			E('div', { 'class': 'cbi-map-descr' }, '每次保存或恢复前都会自动备份原文件（每个文件保留最近 30 份），备份保存在 /etc/nikki-studio/backups，系统升级时保留。'),
			ns.renderHeader(session, { needSource: false }),
			this.content
		]);
	},

	refresh: function() {
		var self = this;
		dom.content(this.content, E('p', { 'class': 'spinning' }, '正在读取备份列表…'));
		return ns.callListBackups(this.all ? '' : this.session.target).then(function(r) {
			dom.content(self.content, self.build(r.backups || []));
		}, function(e) { dom.content(self.content, E('div', { 'class': 'alert-message danger' }, ns.errText(e))); });
	},

	build: function(list) {
		var self = this;
		var all = ns.checkbox(this.all, '显示所有文件的备份');
		ns.cbOf(all).addEventListener('change', function() { self.all = ns.cbOf(all).checked; ns.lsSet('nikki-studio.backup.all', self.all ? '1' : '0'); self.refresh(); });
		var t = E('table', { 'class': 'table ns-list' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, '时间'), E('th', { 'class': 'th' }, '文件'), E('th', { 'class': 'th' }, '类型'),
				E('th', { 'class': 'th' }, '备注'), E('th', { 'class': 'th' }, '大小'), E('th', { 'class': 'th ns-actions' }, '')
			])
		]);
		if (!list.length) t.appendChild(E('tr', { 'class': 'tr placeholder' }, [ E('td', { 'class': 'td', 'colspan': 6 }, E('em', {}, '暂无备份')) ]));
		list.forEach(function(b) {
			t.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, fmtTime(b.time)),
				E('td', { 'class': 'td' }, targetLabel(b.target)),
				E('td', { 'class': 'td' }, [ ns.badge(SOURCE_LABEL[b.source] || b.source, b.source == 'auto-rollback' ? 'err' : 'info'), b.absent ? ns.badge('原文件不存在', 'warn') : '' ]),
				E('td', { 'class': 'td' }, b.note || ''),
				E('td', { 'class': 'td' }, fmtSize(b.size)),
				E('td', { 'class': 'td ns-actions' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.createHandlerFn(self, function() { return self.view(b); }) }, '查看 / 对比'),
					E('button', { 'class': 'cbi-button cbi-button-apply', 'click': function() { self.restore(b); } }, '恢复')
				])
			]));
		});
		return [ E('div', { 'class': 'ns-bar' }, [ all ]), t ];
	},

	view: function(b) {
		return ns.callReadBackup(b.name).then(function(r) {
			if (r.error) throw new Error(r.error);
			var d = ns.renderDiff(r.current, r.content);
			ui.showModal('备份：' + targetLabel(b.target) + ' · ' + fmtTime(b.time), [
				E('p', {}, '与当前文件的差异（- 当前文件，+ 备份内容）：'),
				d.node,
				ns.details('备份完整内容', ns.pre(r.content || '（空文件）')),
				ns.modalButtons([ ns.closeBtn('关闭') ])
			]);
		}).catch(function(e) { ns.notify(ns.errText(e), 'danger'); });
	},

	restore: function(b) {
		var self = this, session = this.session;
		var restart = ns.checkbox(true, '恢复后重启 Nikki（启动失败会自动回滚）');
		var body = E('div', {}, [
			E('p', {}, '将 ' + targetLabel(b.target) + ' 恢复到 ' + fmtTime(b.time) + ' 的版本。当前文件会先被备份。'),
			session.isDirty() ? E('div', { 'class': 'alert-message warning' }, '当前页面有未保存的修改，恢复后这些修改将被丢弃。') : '',
			restart
		]);
		ns.confirmDialog('恢复备份', body, '恢复').then(function(ok) {
			if (!ok) return;
			return ns.runJob('正在恢复…', ns.callRestore(b.name, ns.cbOf(restart).checked)).then(function(res) {
				return session.reload().catch(function() {}).then(function() {
					ns.showResult(session, res.ok ? '恢复成功' : (res.rolled_back ? '启动失败，已自动回滚' : '恢复失败'), res);
				});
			});
		}).catch(function(e) { ns.notify(ns.errText(e), 'danger'); });
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
