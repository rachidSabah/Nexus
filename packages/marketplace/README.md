# @agent-nexus/marketplace

Extension Marketplace for Agent Nexus Gateway - Browse, install, and manage extensions, providers, MCP servers, workflows, and prompts.

## Features

- **Browse Extensions**: Search and filter extensions by type, category, author, and keywords
- **Install/Update/Remove**: Full lifecycle management for extensions
- **Compatibility Checking**: Automatic compatibility verification before installation
- **Signature Verification**: Security through digital signature validation
- **Version Management**: Install specific versions, update, and rollback
- **Publisher Verification**: Verified publisher badges and profiles
- **Dependency Resolution**: Automatic dependency checking and conflict detection
- **Event System**: Emit events for all marketplace operations

## Installation

```bash
pnpm add @agent-nexus/marketplace
```

## Usage

```typescript
import { ExtensionMarketplace } from '@agent-nexus/marketplace';

// Initialize marketplace
const marketplace = new ExtensionMarketplace('0.7.0', {
  signatureVerification: true,
});

// Search for extensions
const results = await marketplace.search({
  type: 'provider',
  category: 'AI Providers',
  keywords: ['ai', 'llm'],
});

// Get extension details
const extension = await marketplace.getExtension('openai-provider');

// Check compatibility
const compatibility = marketplace.checkCompatibility('openai-provider');
if (compatibility.compatible) {
  // Install extension
  await marketplace.install('openai-provider', {
    enableAfterInstall: true,
  });

  // Update extension
  await marketplace.update('openai-provider', {
    backupCurrent: true,
  });

  // Rollback if needed
  await marketplace.rollback('openai-provider', {
    targetVersion: '1.0.0',
    backupCurrent: true,
  });

  // Disable/Enable
  marketplace.disable('openai-provider');
  marketplace.enable('openai-provider');

  // Remove
  await marketplace.remove('openai-provider');
}

// Get installed extensions
const installed = marketplace.getInstalledExtensions();

// Get marketplace stats
const stats = marketplace.getStats();
console.log(`Total extensions: ${stats.totalExtensions}`);
```

## Events

The marketplace emits events for all operations:

```typescript
marketplace.on('extensionInstalled', (extensionId, version) => {
  console.log(`Installed ${extensionId} v${version}`);
});

marketplace.on('extensionUpdated', (extensionId, oldVersion, newVersion) => {
  console.log(`Updated ${extensionId} from ${oldVersion} to ${newVersion}`);
});

marketplace.on('extensionRemoved', (extensionId) => {
  console.log(`Removed ${extensionId}`);
});

marketplace.on('extensionEnabled', (extensionId) => {
  console.log(`Enabled ${extensionId}`);
});

marketplace.on('extensionDisabled', (extensionId) => {
  console.log(`Disabled ${extensionId}`);
});
```

## Extension Types

- `provider`: AI provider adapters (OpenAI, Anthropic, etc.)
- `mcp-server`: Model Context Protocol servers
- `workflow`: Reusable workflow templates
- `prompt`: Prompt templates and libraries
- `template`: Configuration templates
- `theme`: Dashboard themes
- `plugin`: General plugins

## API Reference

### Constructor

```typescript
new ExtensionMarketplace(gatewayVersion: string, options?: {
  signatureVerification?: boolean;
})
```

### Methods

- `search(filters)`: Search marketplace
- `getExtension(id)`: Get extension details
- `checkCompatibility(id)`: Check installation compatibility
- `install(id, options)`: Install extension
- `update(id, options)`: Update extension
- `remove(id)`: Remove extension
- `enable(id)`: Enable extension
- `disable(id)`: Disable extension
- `rollback(id, options)`: Rollback to previous version
- `getInstalledExtensions()`: List installed extensions
- `getInstalledExtension(id)`: Get installed extension details
- `getStats()`: Get marketplace statistics
- `registerPublisher(publisher)`: Register publisher profile
- `addAvailableExtension(extension)`: Add extension to marketplace

## License

Apache-2.0
