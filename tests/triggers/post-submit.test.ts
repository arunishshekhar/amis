import {
  addRemovalReasonNote,
  buildRemovalModNote,
  commentOnPost,
  buildViolationAlert,
  messageAuthor,
  shouldAlertAuthor,
} from '../../src/shared/moderation-comments';

describe('post-submit author alerts', () => {
  it('alerts for violation-oriented actions', () => {
    expect(shouldAlertAuthor({ suggestedAction: 'remove' })).toBe(true);
    expect(shouldAlertAuthor({ suggestedAction: 'monitor' })).toBe(true);
    expect(shouldAlertAuthor({ suggestedAction: 'escalate' })).toBe(true);
    expect(shouldAlertAuthor({ suggestedAction: 'approve' })).toBe(false);
  });

  it('builds a rule and rationale message', () => {
    const message = buildViolationAlert({
      matchedPolicyTitle: 'No spam',
      rationale: 'The post links to repeated promotional content.',
    });

    expect(message).toContain('Your post may violate');
    expect(message).toContain('Rule: No spam');
    expect(message).toContain('Reason: The post links to repeated promotional content.');
  });

  it('submits an app comment on the post', async () => {
    const reddit = {
      submitComment: jest.fn().mockResolvedValue({ id: 't1_comment' }),
    };

    await commentOnPost(reddit as any, 't3_post', buildViolationAlert({
      matchedPolicyTitle: 'No spam',
      rationale: 'Spam-like content.',
    }), 'test');

    expect(reddit.submitComment).toHaveBeenCalledWith({
      id: 't3_post',
      text: expect.stringContaining('Rule: No spam'),
      runAs: 'APP',
    });
  });

  it('does not throw when comment submission fails', async () => {
    const reddit = {
      submitComment: jest.fn().mockRejectedValue(new Error('comment failed')),
    };

    await expect(commentOnPost(reddit as any, 't3_post', 'text', 'test')).resolves.toBeUndefined();
  });

  it('builds a Reddit removal mod note within the API limit', () => {
    const note = buildRemovalModNote({
      matchedPolicyTitle: 'No spam',
      rationale: '[LLM] This post repeats promotional content across multiple submissions.',
    });

    expect(note).toContain('AMIS: No spam');
    expect(note.length).toBeLessThanOrEqual(100);
  });

  it('adds a native Reddit removal reason note', async () => {
    const reddit = {
      addRemovalNote: jest.fn().mockResolvedValue(undefined),
    };

    await addRemovalReasonNote(reddit as any, 't3_post', {
      matchedPolicyTitle: 'No spam',
      rationale: 'Spam-like content.',
    }, 'test');

    expect(reddit.addRemovalNote).toHaveBeenCalledWith({
      itemIds: ['t3_post'],
      reasonId: '',
      modNote: 'AMIS: No spam - Spam-like content.',
    });
  });

  it('does not throw when native removal note creation fails', async () => {
    const reddit = {
      addRemovalNote: jest.fn().mockRejectedValue(new Error('note failed')),
    };

    await expect(addRemovalReasonNote(reddit as any, 't3_post', {
      matchedPolicyTitle: 'No spam',
      rationale: 'Spam-like content.',
    }, 'test')).resolves.toBeUndefined();
  });

  it('messages the post author with the violation alert', async () => {
    const reddit = {
      sendPrivateMessage: jest.fn().mockResolvedValue(undefined),
    };

    await messageAuthor(reddit as any, 'u/alice', 'Subject', 'Body', 'test');

    expect(reddit.sendPrivateMessage).toHaveBeenCalledWith({
      to: 'alice',
      subject: 'Subject',
      text: 'Body',
    });
  });

  it('skips author messages when the author is unavailable', async () => {
    const reddit = {
      sendPrivateMessage: jest.fn(),
    };

    await messageAuthor(reddit as any, '', 'Subject', 'Body', 'test');
    await messageAuthor(reddit as any, '[deleted]', 'Subject', 'Body', 'test');

    expect(reddit.sendPrivateMessage).not.toHaveBeenCalled();
  });
});
