import { useEffect, useState } from 'react';
import { c } from '../theme.js';
import { getPendingSkills, approvePendingSkill, rejectPendingSkill, type PendingSkill } from '../../services/pending-skills.js';
import { saveEvolvingSkill, evolveSkill } from '../../services/skill-store.js';
import { loadAllSkills, invalidateSkillCatalog } from '../../services/skill-catalog.js';
import { showToast } from '../components/toast.js';
import type { Skill } from '@mohanscodex/spectra-agent';

type Tab = 'pending' | 'all';

interface SkillsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: unknown) => void) => void;
	defaultTab?: Tab;
}

export function SkillsDialog({ onClose, termWidth, termHeight, registerHandler, defaultTab }: SkillsDialogProps) {
	const [tab, setTab] = useState<Tab>(defaultTab ?? 'pending');
	const [pending, setPending] = useState<PendingSkill[]>([]);
	const [allSkills, setAllSkills] = useState<Skill[]>([]);
	const [selectedIdx, setSelectedIdx] = useState(0);

	useEffect(() => {
		setPending(getPendingSkills());
		loadAllSkills().then((m) => setAllSkills([...m.values()])).catch(() => {});
	}, []);

	const refreshAll = () => {
		setPending(getPendingSkills());
		invalidateSkillCatalog();
		loadAllSkills().then((m) => setAllSkills([...m.values()])).catch(() => {});
	};

	useEffect(() => {
		const handler = async (rawKey: unknown) => {
			const key = rawKey && typeof rawKey === 'object' && 'name' in rawKey
				? rawKey as { name?: string }
				: {};
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
				return;
			}
			if (key.name === 'tab' || key.name === 'right') {
				setTab((t) => (t === 'pending' ? 'all' : 'pending'));
				setSelectedIdx(0);
				return;
			}
			if (key.name === 'left') {
				setTab((t) => (t === 'all' ? 'pending' : 'all'));
				setSelectedIdx(0);
				return;
			}

			const items = tab === 'pending' ? pending : allSkills;
			if (items.length === 0) return;

			if (key.name === 'up' && selectedIdx > 0) { setSelectedIdx(selectedIdx - 1); return; }
			if (key.name === 'down' && selectedIdx < items.length - 1) { setSelectedIdx(selectedIdx + 1); return; }

			if (tab === 'pending') {
				if (key.name === 'a' || key.name === 'y') {
					const skill = pending[selectedIdx];
					if (!skill) return;
					try {
						const approved = approvePendingSkill(skill.id);
						if (!approved) return;
						if (approved.action === 'evolve') {
							if (!approved.existingSkillId) throw new Error('Missing existing skill id');
							await evolveSkill(approved.existingSkillId, { description: approved.description, whenToUse: approved.whenToUse }, approved.content);
							showToast(`Evolved skill: ${approved.name}`, 'success');
						} else {
							const meta = { id: approved.id, name: approved.name, description: approved.description, whenToUse: approved.whenToUse, tags: [] as string[], useCount: 0, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origin: 'learned' as const };
							await saveEvolvingSkill(meta, approved.content);
							showToast(`Saved skill: ${approved.name}`, 'success');
						}
						refreshAll();
						if (selectedIdx >= getPendingSkills().length) setSelectedIdx(Math.max(0, getPendingSkills().length - 1));
					} catch (err) {
						showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
					}
					return;
				}
				if (key.name === 'r' || key.name === 'd') {
					const skill = pending[selectedIdx];
					if (!skill) return;
					rejectPendingSkill(skill.id);
					showToast(`Rejected: ${skill.name}`, 'info');
					refreshAll();
					if (selectedIdx >= getPendingSkills().length) setSelectedIdx(Math.max(0, getPendingSkills().length - 1));
					return;
				}
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, tab, pending, allSkills, selectedIdx]);

	const mw = Math.min(70, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(22, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<text fg={c.accent} attributes={1}>Skills</text>
					<text fg={c.dim}>esc</text>
				</box>
				<box height={1} paddingX={2} flexDirection="row" gap={3}>
					<text fg={tab === 'pending' ? c.accent : c.dim} attributes={tab === 'pending' ? 1 : 0}>
						Pending{pending.length > 0 ? ` (${pending.length})` : ''}
					</text>
					<text fg={tab === 'all' ? c.accent : c.dim} attributes={tab === 'all' ? 1 : 0}>
						All ({allSkills.length})
					</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={0} flexGrow={1}>
					{tab === 'pending' ? (
						pending.length === 0 ? (
							<text fg={c.dim}>No pending skills.</text>
						) : (
							pending.map((skill, i) => (
								<box key={skill.id} flexDirection="column">
									<text fg={i === selectedIdx ? c.accent : c.text}>
										{i === selectedIdx ? '▸ ' : '  '}{skill.name}
									</text>
									{i === selectedIdx && skill.description && (
										<text fg={c.dim}>  {skill.description.slice(0, innerW - 4)}</text>
									)}
								</box>
							))
						)
					) : (
						allSkills.length === 0 ? (
							<text fg={c.dim}>No skills found.</text>
						) : (
							allSkills.map((skill, i) => (
								<box key={skill.name + skill.location} flexDirection="row" gap={1}>
									<text fg={i === selectedIdx ? c.accent : c.text}>
										{i === selectedIdx ? '▸ ' : '  '}{skill.name}
									</text>
									<text fg={c.dim}>{(skill.description || skill.whenToUse || '').slice(0, Math.max(0, innerW - skill.name.length - 6))}</text>
								</box>
							))
						)
					)}
				</box>
				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center" gap={2}>
					<text fg={c.dim}>←→ tab</text>
					<text fg={c.dim}>↑↓ nav</text>
					{tab === 'pending' && (
						<>
							<text fg={c.success}>a approve</text>
							<text fg={c.error}>r reject</text>
						</>
					)}
					<text fg={c.dim}>esc close</text>
				</box>
			</box>
		</box>
	);
}
