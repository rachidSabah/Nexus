import { BaseIntegration } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Emacs — extensible editor.
 *
 * Configuration depends on which AI package the user has installed. We
 * support the two most popular:
 *   - gptel (Karthink)
 *   - copilot.el (zerolfx)
 *
 * We write `~/.config/emacs/anx-gateway.el` that defines a `gptel` backend
 * pointing at the gateway, plus a snippet for the user's `init.el`.
 *
 * Source: https://www.gnu.org/software/emacs/
 */
export class EmacsIntegration extends BaseIntegration {
  readonly id = 'emacs';
  readonly displayName = 'Emacs';
  readonly description = 'Emacs (gptel + copilot.el)';
  readonly category = 'editor' as const;
  readonly homepage = 'https://www.gnu.org/software/emacs/';

  protected detectBinaries(): string[] {
    return ['emacs'];
  }

  protected detectPaths(): string[] {
    return ['.emacs.d', '.config/emacs'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/emacs/anx-gateway.el',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            ';; Written by Agent Nexus Gateway — anx integrations install emacs',
            ';; In your init.el, add:  (load-file "~/.config/emacs/anx-gateway.el")',
            '',
            '(require \'gptel)',
            '',
            '(defvar anx-gateway-url "' + ctx.gatewayUrl + '/v1/chat/completions")',
            '(defvar anx-gateway-key "' + (ctx.apiKey ?? 'no-key-required') + '")',
            '(defvar anx-gateway-model "' + (resolveModel(ctx) ?? 'gateway-routed') + '")',
            '',
            ';; Define a gptel backend that points at the gateway',
            '(setq gptel-model anx-gateway-model)',
            '(setq gptel-api-key anx-gateway-key)',
            '(setq gptel-use-curl t)',
            '(setq gptel--openai-url anx-gateway-url)',
            '',
            ';; Optional key binding',
            '(global-set-key (kbd "C-c g") \'gptel-send)',
            '',
            ';; copilot.el (if installed)',
            '(when (require \'copilot nil t)',
            '  (setq copilot-enable-predicates nil) ; always on',
            '  (setq copilot-openai-api-key anx-gateway-key)',
            '  (setq copilot-completion-endpoint anx-gateway-url))',
            '',
            '(provide \'anx-gateway)',
            '',
          ].join('\n'),
      },
    ];
  }
}
