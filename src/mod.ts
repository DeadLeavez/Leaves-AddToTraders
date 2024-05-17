import type { DependencyContainer } from "tsyringe";
import type { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";

//item creation
import type { TradeHelper } from "@spt-aki/helpers/TradeHelper";
import type { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import type { Item } from "@spt-aki/models/eft/common/tables/IItem";
import type { FenceService } from "@spt-aki/services/FenceService";
import type { HandbookHelper } from "@spt-aki/helpers/HandbookHelper";
import type { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import type { HashUtil } from "@spt-aki/utils/HashUtil";
import type { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import type { ConfigServer } from "@spt-aki/servers/ConfigServer";
import type { VFS } from "@spt-aki/utils/VFS";
import { jsonc } from "jsonc";

import path from "node:path";
import type { IBarterScheme, ITraderAssort } from "@spt-aki/models/eft/common/tables/ITrader";
import type { PresetHelper } from "@spt-aki/helpers/PresetHelper";
import type { IPreset } from "@spt-aki/models/eft/common/IGlobals";

class AddToTraders implements IPostDBLoadMod
{

    private logger: ILogger;

    //Config
    private db: DatabaseServer;
    private hashUtil: HashUtil;

    private vfs: VFS;

    //Config
    private config: any;
    presetHelper: PresetHelper;


    public preAkiLoad( container: DependencyContainer ): void
    {
        this.logger = container.resolve<ILogger>( "WinstonLogger" );
        this.hashUtil = container.resolve<HashUtil>( "HashUtil" );
        this.vfs = container.resolve<VFS>( "VFS" );
        this.presetHelper = container.resolve<PresetHelper>( "PresetHelper" );

        const configFile = path.resolve( __dirname, "../config/config.jsonc" );
        this.config = jsonc.parse( this.vfs.readFile( configFile ) );
    }

    public postDBLoad( container: DependencyContainer ): void
    {


        this.db = container.resolve<DatabaseServer>( "DatabaseServer" );
        for ( const trader in this.config )
        {
            if ( !this.db.getTables().traders[ trader ] )
            {
                this.logger.logWithColor( `Trader ${ trader } not found in database`, LogTextColor.RED );
                continue;
            }
            this.processTrader( trader );
        }
    }
    processTrader( trader: string )
    {
        const assort = this.db.getTables().traders[ trader ].assort;

        for ( const item of this.config[ trader ] )
        {
            let currency = "";
            switch ( item.currency )
            {
                case "EUR":
                    currency = "569668774bdc2da2298b4568";
                    break;

                case "USD":
                    currency = "5696686a4bdc2da3298b456a";
                    break;

                default:
                    currency = "5449016a4bdc2d6f028b456f";
                    break;
            }

            const tradeID = this.hashUtil.generate();

            const scheme: IBarterScheme = {
                count: item.price,
                _tpl: currency
            };

            if ( !item.preset )
            {
                if ( !this.db.getTables().templates.items[ item.id ] )
                {
                    this.logger.logWithColor( `Item ${ item.id } not found in database`, LogTextColor.RED );
                    continue;
                }
                // Create item object
                const itemToAdd: Item = {
                    _id: tradeID,
                    _tpl: item.id,
                    parentId: "hideout",
                    slotId: "hideout",
                    upd: {
                        StackObjectsCount: item.count,
                        UnlimitedCount: false,
                    },
                };
                assort.barter_scheme[ tradeID ] = [ [ scheme ] ];
                assort.loyal_level_items[ tradeID ] = item.loyaltylevel;
                assort.items.push( itemToAdd );
            }
            else
            {
                if ( !this.db.getTables().globals.ItemPresets[ item.id ] )
                {
                    this.logger.logWithColor( `Preset ${ item.id } not found in database`, LogTextColor.RED );
                    continue;
                }

                const preset = this.presetHelper.getPreset( item.id );
                this.generatePresetAssortItem( assort, preset, scheme, item.loyaltylevel, item.count );
            }
        }
    }

    private generatePresetAssortItem( assort: ITraderAssort, preset: IPreset, scheme: IBarterScheme, loyaltylevel: number, count: number ): void
    {
        this.generateNewItemIds( preset._items );

        const newID = preset._items[ 0 ]._id;
        const newTPL = preset._items[ 0 ]._tpl;

        // Create item object
        const itemToAdd: Item = {
            _id: newID,
            _tpl: newTPL,
            parentId: "hideout",
            slotId: "hideout",
            upd: {
                StackObjectsCount: count,
                UnlimitedCount: false,
            },
        };

        // Add item to assort
        assort.items.push( itemToAdd );

        // we skip the first element, because its the itemToAdd
        for ( let i = 1; i < preset._items.length; i++ )
        {
            assort.items.push( preset._items[ i ] );
        }

        assort.barter_scheme[ newID ] = [ [ scheme ] ];
        assort.loyal_level_items[ newID ] = loyaltylevel;
    }

    private generateNewItemIds( items: Item[] )
    {
        const ids = {}; // this is a map / record / dictionary

        for ( const item of items )
        {
            if ( !ids[ item._id ] )
            {
                // add item id to change
                ids[ item._id ] = this.hashUtil.generate();
                //this.logger.error(`Found id ${item._id}, replace with: ${ids[item._id]}`);
            }
        }

        // replace the item ids
        for ( const oldId in ids )
        {
            // not sure if this actually modifies the reference.
            // you might need a normal for(;;) loop here
            for ( const item of items )
            {
                // update node id
                // not sure if debug messages of the server are shown in release mode, test this!
                if ( item._id === oldId )
                {
                    item._id = ids[ oldId ];
                    //this.logger.error(`Replacing id ${item._id} with: ${ids[oldId]}`);
                }

                if ( item.parentId && item.parentId === oldId )
                {
                    // update parent node id (if it exists)
                    item.parentId = ids[ oldId ];
                    //this.logger.error(`Replacing parent id ${item.parentId} with: ${ids[oldId]}`);
                }
            }
        }
    }

    // biome-ignore lint/suspicious/noExplicitAny: Fuck this rule :P
    private debugJsonOutput( jsonObject: any, label = "" )
    {

        if ( label.length > 0 )
        {
            this.logger.logWithColor( `[${ label }]`, LogTextColor.GREEN );
        }
        this.logger.logWithColor( JSON.stringify( jsonObject, null, 4 ), LogTextColor.MAGENTA );
    }
}

module.exports = { mod: new AddToTraders() }