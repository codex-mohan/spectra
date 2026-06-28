import { useEffect, useState } from 'react';
import { c } from '../theme.js';
import { getPendingSkills, approvePendingSkill, rejectPendingSkill, type PendingSkill } from '../../services/pending-skills.js';
import { saveEvolvingSkill, loadAllEvolvingSkills, evolveSkill } from '../../services/skill-store.js';
import { showToast } from '../components/toast.js';

interface SkillsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

export function SkillsDialog({ onClose, termWidth, termHeight, registerHandler }: SkillsDialogProps) {
	const [pending, setPending] = useState<PendingSkill[]>([]);
	const [selectedIdx, setSelectedIdx] = useState(0);

	useEffect(() => {
		setPending(getPendingSkills());
	}, []);

	useEffect(() => {
		const handler = async (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
				return;
			}
			if (pending.length === 0) return;
			if (key.name === 'up' && selectedIdx > 0) { setSelectedIdx(selectedIdx - 1); return; }
			if (key.name === 'down' && selectedIdx < pending.length - 1) { setSelectedIdx(selectedIdx + 1); return; }
			if (key.name === 'a' || key.name === 'y') {
				const skill = pending[selectedIdx];
				if (!skill) return;
				try {
					const approved = approvePendingSkill(skill.id);
					if (!approved) return;
					if (approved.action === 'evolve') {
						const existing = await loadAllEvolvingSkills();
						const existingSkill = existing.find((item) => item.evolvingSkillId === approved.existingSkillId);
						if (!approved.existingSkillId || !existingSkill) throw new Error(`Cannot evolve missing skill: ${approved.existingSkillId ?? '(none)'}`);
						await evolveSkill(approved.existingSkillId, { description: approved.description, whenToUse: approved.whenToUse }, approved.content);
						showToast(`Evolved skill: ${existingSkill.name}`, 'success');
					} else {
						const meta = { id: approved.id, name: approved.name, description: approved.description, whenToUse: approved.whenToUse, tags: [] as string[], useCount: 0, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origin: 'learned' as const };
						await saveEvolvingSkill(meta, approved.content);
						showToast(`Saved skill: ${approved.name}`, 'success');
					}
					setPending(getPendingSkills());
					if (selectedIdx >= getPendingSkills().length) setSelectedIdx(Math.max(0, getPendingSkills().length - 1));
				} catch (err) {
					showToast(`Failed to save skill: ${err instanceof Error ? err.message : String(err)}`, 'error');
				}
				return;
			}
			if (key.name === 'r' || key.name === 'd') {
				const skill = pending[selectedIdx];
				if (!skill) return;
				rejectPendingSkill(skill.id);
				showToast(`Rejected skill: ${skill.name}`, 'info');
				setPending(getPendingSkills());
				if (selectedIdx >= getPendingSkills().length) setSelectedIdx(Math.max(0, getPendingSkills().length - 1));
				return;
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, pending, selectedIdx]);

	const mw = Math.min(70, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(20, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<text fg={c.accent} attributes={1}>Pending Skills</text>
					<text fg={c.dim}>esc close</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.dim}>{pending.length} pending skill{pending.length !== 1 ? 's' : ''}</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={0} flexGrow={1}>
					{pending.length === 0 && (
						<text fg={c.dim}> No pending skills.</text>
					)}
					{pending.map((skill, i) => (
						<box key={skill.id} flexDirection="column">
							<text fg={i === selectedIdx ? c.accent : c.text}>
								{i === selectedIdx ? '▸ ' : '  '}{skill.name}
							</text>
							{i === selectedIdx && (
								<text fg={c.dim}>  {skill.description.slice(0, innerW - 4)}</text>
							)}
						</box>
					))}
				</box>
				<box height={1} paddingX={2} paddingBottom={1} flexDirection="row" gap={2}>
					<text fg={c.dim}>↑↓ navigate</text>
					<text fg={c.success}>a/y approve</text>
					<text fg={c.error}>r/d reject</text>
				</box>
			</box>
		</box>
	);
}
