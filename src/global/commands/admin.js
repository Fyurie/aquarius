import debug from 'debug';
import dedent from 'dedent-js';
import { humanize } from '../../lib/helpers/lists';
import { pluralize } from '../../lib/helpers/strings';

const log = debug('Admin');

export const info = {
  name: 'admin',
  description: 'Add, remove, and configure commands for your server.',
  usage: dedent`
    **Add a Command:**
    \`\`\`@Aquarius commands add <name>...\`\`\`

    **Remove a Command:**
    \`\`\`@Aquarius commands remove <name>...\`\`\`

    **List Command Settings**
    Run the following command in a Direct Message with Aquarius:
    \`\`\`settings list <name>\`\`\`

    **Modify Command Setting**
    Run the following command in a Direct Message with Aquarius:
    \`\`\`set <command> <setting> <value>\`\`\`

    **Remove Command Setting**
    Run the following in a Direct Message with Aquarius. The default value will be used instead of a custom value.
    \`\`\`unset <command> <setting>\`\`\`

    **See Enabled or Disabled Commands**
    To view your server's enabled or disabled commands, run
    \`\`\`@Aquarius help\`\`\`
  `,
};

async function getGuildTarget(aquarius, message) {
  let target = 0;

  const guilds = aquarius.guilds.filter(guild =>
    aquarius.permissions.isGuildAdmin(guild, message.author)
  );

  if (guilds.size === 0) {
    message.channel.send('You need to be a guild admin to use this command!');
  } else if (guilds.size === 1) {
    // eslint-disable-next-line prefer-destructuring
    target = Array.from(guilds.keys())[0];
  } else if (guilds.size > 1) {
    try {
      const msg = await aquarius.directMessages.prompt(
        message.author,
        "You're an admin in several guilds - what is the ID of the one you want to check?"
      );
      target = msg.cleanContent;

      if (!guilds.some(guild => guild.id === target)) {
        message.channel.send("You aren't an admin in that server!");
        return 0;
      }
    } catch (error) {
      message.channel.send('Sorry, something happened. Please try again!');
      return 0;
    }
  }

  return target;
}

// TODO: Make better use of direct-message manager here
/** @type {import('../../typedefs').Command} */
export default async ({ aquarius, analytics }) => {
  // TODO: Add help message for help settings, settings, and settings help. Log all DM messages that aren't matched

  aquarius.onDirectMessage(
    /settings list (?<command>.+)/i,
    async (message, { groups }) => {
      log('Setting list');

      const { channel } = message;
      const guild = await getGuildTarget(aquarius, message);

      if (!guild) {
        log('Non-admin account, exiting');
        return;
      }

      const config = aquarius.commandConfigs.get(groups.command);

      if (!config) {
        log(`No settings for ${groups.command}`);
        channel.send(`I couldn't find a command names ${groups.command}`);
        return;
      }

      // TODO: Indicate Defaults somehow?
      const keys = config
        .keys()
        .reduce(
          (str, key) => `${str}* \`${key}\`: ${config.get(guild, key)}\n`,
          ''
        );

      const msg = dedent`
        **Settings for ${groups.command}**

        ${keys}

        **To modify a setting:**
        \`\`\`set <command> <setting> <value>\`\`\`
        **To remove a setting:**
        \`\`\`unset <command> <setting>\`\`\`
      `;

      channel.send(msg);
      analytics.trackUsage('settings list', message);
    }
  );

  aquarius.onDirectMessage(
    /set (?<command>.+) (?<setting>.+) (?<value>.+)/i,
    async (message, { groups }) => {
      log('Set command setting');
      const { channel } = message;
      const { command, setting, value } = groups;

      const guild = await getGuildTarget(aquarius, message);

      if (!guild) {
        log('Non-admin account, exiting');
        return;
      }

      if (!aquarius.commandList.has(command)) {
        log(`No settings for ${command}`);
        channel.send(`I can't find a command named "${command}", sorry!`);
        return;
      }

      if (!aquarius.guildManager.get(guild).enabledCommands.has(command)) {
        log(`${command} isn't enabled on server`);
        channel.send(
          `It doesn't look like ${command} is enabled on your server!`
        );
        return;
      }

      if (
        !aquarius.commandConfigs
          .get(command)
          .keys()
          .includes(setting)
      ) {
        log(`Invalid setting name: ${setting}`);
        channel.send(
          `It doesn't look like ${command} has a setting called "${setting}"`
        );
        return;
      }

      aquarius.commandConfigs.get(command).set(guild, setting, value);

      channel.send(`Updated ${command}!`);
      analytics.trackUsage('set', message);
    }
  );

  aquarius.onDirectMessage(
    /unset (?<command>.+) (?<setting>.+)/i,
    async (message, { groups }) => {
      log('Unset command setting');
      const { channel } = message;
      const { command, setting } = groups;
      const guild = await getGuildTarget(aquarius, message);

      if (!guild) {
        log('Non-admin account, exiting');
        return;
      }

      if (!aquarius.commandList.has(command)) {
        log(`No settings for ${command}`);
        channel.send(`I can't find a command named "${command}", sorry!`);
        return;
      }

      if (
        !aquarius.guildManager.get(guild).enabledCommands.has(groups.command)
      ) {
        log(`${command} isn't enabled on server`);
        channel.send(
          `It doesn't look like ${groups.command} is enabled on your server!`
        );
        return;
      }

      if (
        !aquarius.commandConfigs
          .get(command)
          .keys()
          .includes(setting)
      ) {
        log(`Invalid setting name: ${setting}`);
        channel.send(
          `It doesn't look like ${command} has a setting called "${setting}"`
        );
        return;
      }

      aquarius.commandConfigs.get(command).remove(guild, setting);

      channel.send(`Updated ${groups.command}!`);
      analytics.trackUsage('unset', message);
    }
  );

  aquarius.onCommand(
    /commands (add|enable) (?<commands>.+)/i,
    async (message, { groups }) => {
      if (aquarius.permissions.isGuildAdmin(message.guild, message.author)) {
        log(
          `Add ${groups.commands} in ${message.guild.name} by ${
            message.author.username
          }`
        );

        let response = '';
        const addedCommands = [];
        const commandsWithSettings = [];
        const unknownCommands = [];

        groups.commands.split(' ').forEach(command => {
          const name = command.toLowerCase();

          if (aquarius.commandList.has(name)) {
            aquarius.guildManager.get(message.guild.id).enableCommand(name);
            addedCommands.push(name);

            if (aquarius.commandConfigs.get(name).hasSettings()) {
              commandsWithSettings.push(name);
            }
          } else {
            unknownCommands.push(name);
          }
        });

        if (addedCommands.length > 0) {
          response += `Added the ${humanize(addedCommands)} ${pluralize(
            'command',
            addedCommands.length
          )}. \n\n`;
        }

        if (commandsWithSettings.length > 0) {
          response += `You can configure the ${humanize(
            commandsWithSettings
          )} ${pluralize(
            'command',
            commandsWithSettings.length
          )} - direct message me \`settings list <name>\` with a command name to learn more.\n\n`;
        }

        if (unknownCommands.length > 0) {
          response += `I don't recognize the ${humanize(
            unknownCommands
          )} ${pluralize('command', unknownCommands.length)}.`;
        }

        message.channel.send(response);
        analytics.trackUsage('add', message);
      }
    }
  );

  aquarius.onCommand(
    /commands (remove|disable) (?<commands>.+)/i,
    async (message, { groups }) => {
      if (aquarius.permissions.isGuildAdmin(message.guild, message.author)) {
        log(
          `Remove ${groups.commands} in ${message.guild.name} by ${
            message.author.username
          }`
        );

        let response = '';
        const removedCommands = [];
        const unknownCommands = [];
        const globalCommands = [];

        groups.commands.split(' ').forEach(command => {
          const name = command.toLowerCase();

          if (aquarius.commandList.has(name)) {
            const commandInfo = aquarius.commandList.get(name);

            if (commandInfo.global) {
              globalCommands.push(name);
            } else {
              aquarius.guildManager.get(message.guild.id).disableCommand(name);
              removedCommands.push(name);
            }
          } else {
            unknownCommands.push(name);
          }
        });

        if (removedCommands.length > 0) {
          response += `Removed the ${humanize(removedCommands)} ${pluralize(
            'command',
            removedCommands.length
          )}. `;
        }

        if (unknownCommands.length > 0) {
          response += `I don't recognize the ${humanize(
            unknownCommands
          )} ${pluralize('command', unknownCommands.length)}.`;
        }

        if (globalCommands.length > 0) {
          response += `The ${humanize(globalCommands)} ${pluralize(
            'command is',
            globalCommands.length,
            'commands are'
          )} considered 'Global' - Global commands are core to Aquarius and can't be disabled.`;
        }

        message.channel.send(response);
        analytics.trackUsage('remove', message);
      }
    }
  );
};
