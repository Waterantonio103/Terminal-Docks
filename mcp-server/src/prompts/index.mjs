export function registerPrompts(server) {
  server.registerPrompt('collaboration_protocol', {
    title: 'Team Collaboration Protocol',
    description: 'Standard operating procedure for multi-agent collaboration.',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# Team Collaboration Protocol\n\nCall get_collaboration_protocol() for the full SOP.`,
      },
    }],
  }));

  const roles = ['scout', 'coordinator', 'builder', 'tester', 'security', 'reviewer'];
  for (const role of roles) {
    server.registerPrompt(`role/${role}`, {
      title: `Role Prompt: ${role}`,
      description: `Standard prompt for the ${role} role.`,
    }, () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `You are acting as the ${role.toUpperCase()}. Please check your specific instructions in the mission configuration.`,
        },
      }],
    }));
  }
}
