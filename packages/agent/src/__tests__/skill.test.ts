import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Skill frontmatter parsing', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-skill-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('parses LF line endings', async () => {
		const skillDir = join(tmpDir, 'test-skill');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Test Skill\ndescription: A test skill\n---\n\n# Body');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		expect(skills.has('Test Skill')).toBe(true);
		expect(skills.get('Test Skill')!.description).toBe('A test skill');
	});

	it('parses CRLF line endings', async () => {
		const skillDir = join(tmpDir, 'crlf-skill');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\r\nname: CRLF Skill\r\ndescription: Has CRLF\r\n---\r\n\r\n# Body');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		expect(skills.has('CRLF Skill')).toBe(true);
		expect(skills.get('CRLF Skill')!.description).toBe('Has CRLF');
	});

	it('handles mixed line endings in same file', async () => {
		const skillDir = join(tmpDir, 'mixed-skill');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\r\nname: Mixed Skill\r\ndescription: Mixed endings\n---\n\n# Body');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		expect(skills.has('Mixed Skill')).toBe(true);
	});

	it('returns empty name for files without frontmatter', async () => {
		const skillDir = join(tmpDir, 'no-frontmatter');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '# Just a heading\n\nNo frontmatter here.');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		// The no-frontmatter skill should not be found (empty name filtered out)
		const allNames = Array.from(skills.keys());
		expect(allNames).not.toContain('');
	});
});

describe('Skill discovery — nested directories', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-nested-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('discovers skills in category subdirectories', async () => {
		const catDir = join(tmpDir, 'debugging');
		const skillDir = join(catDir, 'my-debug-skill');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Debug Skill\ndescription: Debug stuff\n---\n\n# Debug');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		expect(skills.has('Debug Skill')).toBe(true);
	});

	it('discovers both top-level and nested skills', async () => {
		// Top-level skill
		const topDir = join(tmpDir, 'top-skill');
		mkdirSync(topDir, { recursive: true });
		writeFileSync(join(topDir, 'SKILL.md'), '---\nname: Top Skill\ndescription: Top level\n---\n\n# Top');

		// Nested skill
		const catDir = join(tmpDir, 'category');
		const nestedDir = join(catDir, 'nested-skill');
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(join(nestedDir, 'SKILL.md'), '---\nname: Nested Skill\ndescription: Nested level\n---\n\n# Nested');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		expect(skills.has('Top Skill')).toBe(true);
		expect(skills.has('Nested Skill')).toBe(true);
	});

	it('skips directories without SKILL.md', async () => {
		const emptyDir = join(tmpDir, 'empty-category');
		mkdirSync(emptyDir, { recursive: true });
		writeFileSync(join(emptyDir, 'readme.txt'), 'No skills here');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		// Should not find any skills from the empty category
		const allNames = Array.from(skills.keys());
		expect(allNames.some((n) => n.includes('empty-category') || n.includes('readme'))).toBe(false);
	});
});

describe('Skill tag extraction', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-tags-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('extracts category from directory path', async () => {
		// Category extraction requires a "skills" segment in the path
		const skillsDir = join(tmpDir, 'skills');
		const catDir = join(skillsDir, 'deployment');
		const skillDir = join(catDir, 'vercel-deploy');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Vercel Deploy\ndescription: Deploy to Vercel\n---\n\n# Deploy');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [skillsDir] });
		const skill = skills.get('Vercel Deploy');
		expect(skill).toBeDefined();
		expect(skill!.tags).toContain('deployment');
		expect(skill!.tags).toContain('vercel');
		expect(skill!.tags).toContain('deploy');
	});

	it('extracts name segments as tags', async () => {
		const skillDir = join(tmpDir, 'test-driven-development');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Test Driven Development\ndescription: TDD workflow\n---\n\n# TDD');

		const { discoverSkills } = await import('../skill.js');
		const skills = await discoverSkills({ customPaths: [tmpDir] });
		const skill = skills.get('Test Driven Development');
		expect(skill).toBeDefined();
		expect(skill!.tags).toContain('test');
		expect(skill!.tags).toContain('driven');
		expect(skill!.tags).toContain('development');
	});
});
