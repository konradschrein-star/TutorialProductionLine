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
    expect(users[0].role).toBe('admin');
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
});
