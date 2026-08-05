import { BaseIntegration } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Neovim — extensible Vim fork.
 *
 * Configuration depends on which AI plugin the user has installed. We
 * support the two most popular:
 *   - codecompanion.nvim (João Bortoletto)
 *   - avante.nvim (yetone)
 *
 * We write a starter `~/.config/nvim/lua/anx-gateway.lua` that defines an
 * adapter named `nexus` for both plugins, plus a snippet showing how to
 * wire it into the user's `init.lua`.
 *
 * Source: https://neovim.io
 */
export class NeovimIntegration extends BaseIntegration {
  readonly id = 'neovim';
  readonly displayName = 'Neovim';
  readonly description = 'Neovim (codecompanion.nvim + avante.nvim)';
  readonly category = 'editor' as const;
  readonly homepage = 'https://neovim.io';

  protected detectBinaries(): string[] {
    return ['nvim'];
  }

  protected detectPaths(): string[] {
    return ['.config/nvim'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/nvim/lua/anx-gateway.lua',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '-- Written by Agent Nexus Gateway — anx integrations install neovim',
            '-- In your init.lua, add:  require("anx-gateway").setup()',
            '',
            'local M = {}',
            '',
            'function M.setup(opts)',
            '  opts = opts or {}',
            '  local gateway_url = opts.url or "' + ctx.gatewayUrl + '/v1"',
            '  local api_key = opts.api_key or "' + (ctx.apiKey ?? 'no-key-required') + '"',
            '  local model = opts.model or "' + ctx.defaultModel + '"',
            '',
            '  -- codecompanion.nvim adapter',
            '  local ok_cc, cc = pcall(require, "codecompanion.adapters")',
            '  if ok_cc then',
            '    cc.nexus = cc.extend("openai", {',
            '      env = { api_key = api_key, url = gateway_url },',
            '      headers = { ["Authorization"] = "Bearer " .. api_key },',
            '      schema = { model = { default = model } },',
            '    })',
            '  end',
            '',
            '  -- avante.nvim provider',
            '  local ok_av, av = pcall(require, "avante.providers")',
            '  if ok_av then',
            '    av.nexus = {',
            '      endpoint = gateway_url .. "/chat/completions",',
            '      model = model,',
            '      api_key_name = api_key,',
            '      parse_response_data = function(data, opts)',
            '        if data.choices and data.choices[1] then',
            '          opts.callback(data.choices[1].delta.content or "", { stop = data.choices[1].finish_reason ~= nil })',
            '        end',
            '      end,',
            '    }',
            '  end',
            'end',
            '',
            'return M',
            '',
          ].join('\n'),
      },
      {
        path: '.config/nvim/lua/anx-gateway-init-snippet.lua',
        merge: 'overwrite' as const,
        content: () =>
          [
            '-- Add this to your init.lua to enable Agent Nexus Gateway:',
            '',
            'require("anx-gateway").setup({',
            '  -- url = "http://localhost:8787/v1",  -- (defaults shown)',
            '  -- api_key = os.getenv("NEXUS_API_KEY"),',
            '  -- model = "gpt-4",',
            '})',
            '',
            '-- Then set in codecompanion:',
            '-- require("codecompanion").setup({ adapters = { nexus = "nexus" } })',
            '',
          ].join('\n'),
      },
    ];
  }
}
