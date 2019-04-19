import { ObjectID } from "mongodb";
import { createQuery } from "odata-v4-mongodb";
import { ODataController, Edm, odata, ODataQuery } from "odata-v4-server";
import { Expert } from "../models/Expert";
import { Trader } from "../models/Trader";
import { Ticker } from "../models/Ticker";
import { Balance } from "../models/Balance";
import { Portfolio } from "../models/Portfolio";
import { Order } from "../models/Order";
import connect from "../connect";
const exchange = require('../../../exchange'); // заменить на TS

const collectionName = "trader";

@odata.type(Trader)
@Edm.EntitySet("Traders")
export class TraderController extends ODataController {
  async get(@odata.query query: ODataQuery): Promise<Trader[]> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    // TODO комплексные объекты необходимо хранить не в базе данных, а в памяти
    // в списочном виде такие объекты можно не возвращать
    if (typeof mongodbQuery.query._id == "string") mongodbQuery.query._id = new ObjectID(mongodbQuery.query._id);
    let result = typeof mongodbQuery.limit == "number" && mongodbQuery.limit === 0 ? [] : await db.collection(collectionName)
      .find(mongodbQuery.query)
      .project(mongodbQuery.projection)
      .skip(mongodbQuery.skip || 0)
      .limit(mongodbQuery.limit || 0)
      .sort(mongodbQuery.sort)
      .toArray();//TODO заменить на поток
    if (mongodbQuery.inlinecount) {
      (<any>result).inlinecount = await db.collection(collectionName)
        .find(mongodbQuery.query)
        .project(mongodbQuery.projection)
        .count(false);
    }
    return result;
  }

  @odata.GET
  async getById(@odata.key key: string, @odata.query query: ODataQuery): Promise<Trader> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    // console.log(query // на самом деле обращение должно происходить к движку
    // этот движок должен кэшировать сохраненный объект, ловить все изменения к нему
    // этот движок должен самостоятельно взаимодействовать с другими API
    // движок сам понимает в каком состоянии он находится и какие данные возвращать
    // самы выбирает способ получения данных, кэшировать их или нет и т.п.
    // движок снимет проблему синхорнизации запросов
    const keyId = new ObjectID(key);
    const { projection } = mongodbQuery;
    projection.currency = 1;
    projection.asset = 1;
    projection.user = 1;
    projection.pass = 1;

    const trader = new Trader(await db.collection(collectionName).findOne({ _id: keyId }, { projection }));
    await new Promise(resolve => { // TODO эти данные сервер может обновлять по расписанию, результат помещать во временное хранилище
      // в активном состоянии обращение будет происходить к кэшу, в неактивном как сейчас
      exchange.getOrders(trader, (err, orders: any[]) => {
        trader.hasOrders = !!orders.length;
        if (orders.length) {
          trader.Order = new Order(orders[0]);
        } else {
          delete trader.Order;
        }
        resolve();
      });
    });

    await new Promise(resolve => {
      exchange.getTicker(trader, (err, ticker) => {
        trader.Ticker = new Ticker(ticker);
        trader.inSpread = trader.hasOrders
          && trader.Order.price <= ticker.ask
          && trader.Order.price >= ticker.bid;
        trader.canCancel = !!trader.hasOrders;
        trader.toCancel = trader.canCancel && !trader.inSpread;
        resolve();
      });
    });

    await new Promise(resolve => {
      exchange.getPortfolio(trader, (err, portfolio: Portfolio[]) => {
        const balance = portfolio.find(e => e.currency === trader.currency);
        const balanceAsset = portfolio.find(e => e.currency === trader.asset);
        trader.Balance = new Balance({
          available: balance ? balance.available : 0,
          availableAsset: balanceAsset ? balanceAsset.available : 0
        });
        resolve();
      });
    });

    const decimals = 6;
    trader.buyQuantity = +((Math.floor((trader.Balance.available / trader.Ticker.bid) * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals));
    // console.log(trader.buyQuantity);
    // num = 19.66752
    // f = num.toFixed(3).slice(0,-1)

    const expert = new Expert(await db.collection("expert").findOne({ _id: trader.expertId }));
    trader.canBuy = !trader.hasOrders && trader.Balance.available > 0;
    trader.toBuy = trader.canBuy && expert.advice === 1;
    trader.canSell = !trader.hasOrders && trader.Balance.availableAsset > 0; 
    trader.toSell = trader.canSell && expert.advice === -1;

    return trader;
  }

  @odata.POST
  async post(@odata.body data: any): Promise<Trader> {
    const db = await connect();
    // const trader = new Trader(data); // добавить проверку входящих данных на соответствие типам
    // никогда не доверяй внешним входящим данным!!!
    if (data.expertId) data.expertId = new ObjectID(data.expertId);
    const { historyId } = await db.collection("expert").findOne({ _id: data.expertId });
    const { currency, asset } = await db.collection("history").findOne({ _id: historyId });
    data.currency = currency;
    data.asset = asset;
  
    return db.collection(collectionName).insertOne(data).then((result) => {
      data._id = result.insertedId;
      return new Trader(data);
    });
  }

  @odata.PATCH
  async patch(@odata.key key: string, @odata.body delta: any): Promise<number> {
    const db = await connect();
    if (delta._id) delete delta._id;
    let keyId;
    try { keyId = new ObjectID(key); } catch(err) { keyId = key; }
    return await db.collection(collectionName).updateOne({_id: keyId}, {$set: delta}).then(result => result.modifiedCount);
  }

  @odata.DELETE
  async delete(@odata.key key: string): Promise<number> {
    const db = await connect();
    let keyId;
    try { keyId = new ObjectID(key); } catch(err) { keyId = key; }
    return await db.collection(collectionName).deleteOne({_id: keyId}).then(result => result.deletedCount);
  }

  @odata.GET("Expert")
  async getExpert(@odata.result result: any, @odata.query query: ODataQuery): Promise<Expert> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    const expertId = new ObjectID(result.expertId);
    return await db.collection("expert").findOne({ _id: expertId }, {
      fields: mongodbQuery.projection
    });
  }
}
