// Nikki Studio - background job runner
// usage: ucode -S /usr/libexec/nikki-studio/job.uc JOB_ID
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

import { access, readfile, unlink } from 'fs';
import * as lib from '/usr/share/nikki-studio/lib.uc';

const id = ARGV[0];
if (!lib.valid_job_id(id))
	exit(1);

const dir = lib.job_dir(id);
const job = lib.parse_json(readfile(dir + '/job.json') ?? 'null').value;
if (!job)
	exit(1);

const status = { id: id, type: job.type, state: 'running', stage: 'start', started: time(), pid: lib.getpid() };
lib.write_status(id, status);

function progress(stage) {
	status.stage = stage;
	lib.write_status(id, status);
}

function patch_hash(target, patch) {
	return lib.md5_string(target + '\n' + sprintf('%J', patch ?? {}));
}

function sleep(sec) {
	system('sleep ' + (+sec || 1));
}

function count_lines(path) {
	return length(lib.read_lines(path));
}

// Restart Nikki and wait until it is healthy.
function restart_and_check() {
	const c = lib.uci_nikki();
	if (!lib.uci_bool(c.get('nikki', 'config', 'enabled')))
		return { ok: true, skipped: true, message: 'Nikki 未启用，已跳过重启' };
	const proxy_enabled = lib.uci_bool(c.get('nikki', 'proxy', 'enabled'));

	progress('restart');
	let before = count_lines(lib.APP_LOG);
	const to = lib.find_timeout();
	lib.run((to ? to + ' 240 ' : '') + '/etc/init.d/nikki restart >/dev/null 2>&1');

	progress('health');
	const deadline = time() + 90;
	let reason = '等待超时：Nikki 未在 90 秒内完成启动';
	while (time() < deadline) {
		let lines = lib.read_lines(lib.APP_LOG);
		if (length(lines) < before)
			before = 0;
		const fresh = join('\n', slice(lines, before));
		if (match(fresh, /\[App\] Exit\./) || match(fresh, /Check failed\.|Test failed\.|TUN device is not online/)) {
			reason = 'Nikki 启动失败';
			return { ok: false, message: reason, log: slice(lines, before) };
		}
		const core_started = match(fresh, /\[Core\] Start\./) != null;
		const proxy_ok = !proxy_enabled || match(fresh, /\[Proxy\] Hijack successful\./) != null;
		if (core_started && proxy_ok && lib.nikki_running()) {
			const ep = lib.api_endpoint();
			if (!ep)
				return { ok: true, message: 'Nikki 已成功启动' };
			const v = lib.api_get('/version', 3);
			if (!v.error)
				return { ok: true, message: 'Nikki 已成功启动', version: v.value?.version };
		}
		sleep(2);
	}
	const lines = lib.read_lines(lib.APP_LOG);
	return { ok: false, message: reason, log: slice(lines, before) };
}

function core_log_tail() {
	const l = lib.read_lines(lib.CORE_LOG);
	return slice(l, length(l) > 50 ? length(l) - 50 : 0);
}

// Write `content` into target, with backup / optional restart / auto rollback.
function apply(t, content, restart, source, note) {
	progress('backup');
	const backup = lib.create_backup(t, source, note);
	const backup_path = lib.BACKUP_DIR + '/' + backup;
	const was_absent = !access(t.path);

	progress('write');
	if (!lib.atomic_write(t.path, content))
		return { ok: false, stage: 'write', message: '写入文件失败', backup: backup };

	const res = { ok: true, stage: 'done', message: '已保存', backup: backup, md5: lib.md5(t.path) };
	if (!restart)
		return res;

	const h = restart_and_check();
	res.health = h;
	if (h.ok) {
		res.message = h.skipped ? '已保存（' + h.message + '）' : '已保存并重启 Nikki';
		return res;
	}

	// rollback
	progress('rollback');
	const failed_backup = lib.create_backup(t, 'auto-rollback', '启动失败的版本');
	if (was_absent)
		unlink(t.path);
	else
		lib.atomic_write(t.path, readfile(backup_path) ?? '');
	const h2 = restart_and_check();
	return {
		ok: false, stage: 'health', rolled_back: true,
		message: 'Nikki 使用新配置启动失败，已自动恢复到保存前的版本' + (h2.ok ? '并重新启动成功' : '，但重新启动仍未成功，请检查 Nikki 日志'),
		backup: backup, failed_backup: failed_backup,
		health: h, health_after_rollback: h2, core_log: core_log_tail(), md5: lib.md5(t.path)
	};
}

function do_validate() {
	const t = lib.resolve_target(job.target);
	if (!t)
		return { ok: false, stage: 'precheck', message: '无效的编辑目标' };
	const r = lib.validate(job.target, job.patch ?? {}, dir, progress);
	r.patch_hash = patch_hash(job.target, job.patch);
	r.target_md5 = lib.md5(t.path);
	return r;
}

function do_save() {
	const t = lib.resolve_target(job.target);
	if (!t)
		return { ok: false, stage: 'precheck', message: '无效的编辑目标' };
	if ((job.base_md5 ?? '') != lib.md5(t.path))
		return { ok: false, stage: 'precheck', code: 'CONFLICT', message: '文件已被其他程序修改（例如手动编辑或定时脚本），请重新加载后再保存' };

	const hash = patch_hash(job.target, job.patch);
	let cand = null, vres = null;
	if (lib.valid_job_id(job.reuse_job)) {
		const prev = lib.read_status(job.reuse_job);
		const pr = prev?.result;
		if (prev && prev.state == 'done' && pr?.ok && pr.patch_hash == hash && pr.target_md5 == lib.md5(t.path) && (prev.finished ?? 0) > time() - 600 && access(lib.job_dir(job.reuse_job) + '/candidate.yaml')) {
			cand = lib.job_dir(job.reuse_job) + '/candidate.yaml';
			vres = pr;
		}
	}
	if (!cand) {
		vres = lib.validate(job.target, job.patch ?? {}, dir, progress);
		if (!vres.ok)
			return vres;
		cand = dir + '/candidate.yaml';
	}
	const res = apply(t, readfile(cand) ?? '', !!job.restart, 'save', job.note);
	res.validation = { warnings: vres.warnings, stats: vres.stats, source_note: vres.source_note };
	return res;
}

function do_restore() {
	const m = match(job.name ?? '', lib.BACKUP_RE);
	if (!m)
		return { ok: false, stage: 'precheck', message: '无效的备份名称' };
	const target = lib.label_target(m[3]);
	const t = lib.resolve_target(target);
	if (!t && target != 'mixin')
		return { ok: false, stage: 'precheck', message: '备份对应的配置文件已不存在' };
	const content = readfile(lib.BACKUP_DIR + '/' + job.name);
	if (content == null)
		return { ok: false, stage: 'precheck', message: '读取备份失败' };
	const res = apply(t, content, !!job.restart, 'restore', '恢复前的版本');
	if (res.ok)
		res.message = job.restart ? '已恢复并重启 Nikki' : '已恢复';
	return res;
}

let result;
if (!lib.lock_acquire(id)) {
	result = { ok: false, stage: 'lock', code: 'BUSY', message: '另一个任务正在进行，请稍后再试' };
}
else {
	try {
		if (job.type == 'validate')
			result = do_validate();
		else if (job.type == 'save')
			result = do_save();
		else if (job.type == 'restore')
			result = do_restore();
		else
			result = { ok: false, message: 'unknown job type' };
	}
	catch (e) {
		result = { ok: false, stage: status.stage, message: '内部错误：' + e };
	}
	lib.lock_release();
}

status.state = 'done';
status.finished = time();
status.result = result;
lib.write_status(id, status);
lib.prune_jobs();
