import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService, DEFAULT_USERS } from '../services/storageService';
import { VAUser } from '../types';

describe('Account & Team Management Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should list default admin and VA users', () => {
    const users = StorageService.getUsers();
    expect(users.length).toBe(DEFAULT_USERS.length);
    expect(users.some(u => u.role === 'admin')).toBe(true);
  });


  it('should create, update, and persist a new VA operator account', () => {
    const newUser: VAUser = {
      id: 'usr_new_test',
      name: 'Sarah Connor (VA)',
      email: 'sarah@production.team',
      role: 'va',
      assignedChannels: ['virtualfd', 'skool']
    };

    StorageService.saveUser(newUser);
    const updated = StorageService.getUsers();
    expect(updated.some(u => u.id === 'usr_new_test')).toBe(true);

    // Update role to manager
    StorageService.saveUser({ ...newUser, role: 'manager' });
    const managerUser = StorageService.getUsers().find(u => u.id === 'usr_new_test');
    expect(managerUser?.role).toBe('manager');
  });

  it('should switch active operator session and persist', () => {
    const target = DEFAULT_USERS[2];
    StorageService.setActiveUser(target);

    const active = StorageService.getActiveUser();
    expect(active.id).toBe(target.id);
    expect(active.name).toBe(target.name);
  });

  it('should delete operator account and fall back active user safely', () => {
    const newUser: VAUser = {
      id: 'usr_delete_target',
      name: 'Temporary User',
      email: 'temp@production.team',
      role: 'va',
      assignedChannels: ['skool']
    };

    StorageService.saveUser(newUser);
    StorageService.setActiveUser(newUser);
    expect(StorageService.getActiveUser().id).toBe('usr_delete_target');

    StorageService.deleteUser('usr_delete_target');
    const remaining = StorageService.getUsers();
    expect(remaining.some(u => u.id === 'usr_delete_target')).toBe(false);
    expect(StorageService.getActiveUser().id).not.toBe('usr_delete_target');
  });

  it('should include Omar and Jeen as default administrators', () => {
    const users = StorageService.getUsers();
    const omar = users.find(u => u.name.includes('Omar') || u.email === 'omar@tutorialstudio.com');
    const jeen = users.find(u => u.name.includes('Jeen') || u.email === 'jeen@tutorialstudio.com');
    expect(omar).toBeDefined();
    expect(omar?.role).toBe('admin');
    expect(jeen).toBeDefined();
    expect(jeen?.role).toBe('admin');
  });

  it('should assign, update, and persist assignedSoftwares for VAs', () => {
    const vaUser: VAUser = {
      id: 'usr_va_softwares',
      name: 'Excel & Notion Specialist',
      email: 'specialist@production.team',
      role: 'va',
      assignedChannels: ['virtualfd'],
      assignedSoftwares: ['Excel', 'Notion', 'Power BI']
    };

    StorageService.saveUser(vaUser);
    const retrieved = StorageService.getUsers().find(u => u.id === 'usr_va_softwares');
    expect(retrieved?.assignedSoftwares).toEqual(['Excel', 'Notion', 'Power BI']);

    // Update assigned softwares
    StorageService.saveUser({ ...vaUser, assignedSoftwares: ['Excel', 'Figma'] });
    const updated = StorageService.getUsers().find(u => u.id === 'usr_va_softwares');
    expect(updated?.assignedSoftwares).toEqual(['Excel', 'Figma']);
  });

  it('should have Nalu restored as an active Tutorial VA with assigned channels and softwares', () => {
    const users = StorageService.getUsers();
    const nalu = users.find(u => u.name.toLowerCase() === 'nalu' || u.email === 'nalu@tutorialstudio.com');
    expect(nalu).toBeDefined();
    expect(nalu?.role).toBe('va');
    expect(nalu?.assignedChannels).toContain('virtualfd');
    expect(nalu?.assignedChannels).toContain('skool');
    expect(nalu?.assignedChannels).toContain('blueprint');
    expect(nalu?.assignedSoftwares).toEqual(expect.arrayContaining(['Notion', 'Figma', 'Canva', 'Excel']));
  });

  it('should default active operator to Nalu so she can work immediately', () => {
    const active = StorageService.getActiveUser();
    expect(active.name).toBe('Nalu');
    expect(active.role).toBe('va');
  });

  it('should self-heal legacy VA placeholders in localStorage to Nalu and Lorraine', () => {
    // Simulate an existing browser session with legacy VA1 and VA2 in custom_users
    const legacyUsers = [
      { id: '3', name: 'Virtual Assistant 1', email: 'va1@tutorialstudio.com', role: 'va', assignedChannels: ['skool'] },
      { id: '4', name: 'Virtual Assistant 2', email: 'va2@tutorialstudio.com', role: 'va', assignedChannels: ['virtualfd'] }
    ];
    localStorage.setItem('tpl_custom_users', JSON.stringify(legacyUsers));

    const healedUsers = StorageService.getUsers();
    const nalu = healedUsers.find(u => u.id === '3');
    const lorraine = healedUsers.find(u => u.id === '4');

    expect(nalu?.name).toBe('Nalu');
    expect(nalu?.email).toBe('nalu@tutorialstudio.com');
    expect(nalu?.assignedSoftwares).toBeDefined();
    expect(lorraine?.name).toBe('Lorraine');
    expect(lorraine?.email).toBe('lorraine@tutorialstudio.com');
  });
});
