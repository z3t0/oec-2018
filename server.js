// Import required modules.
const request = require('request');
const regression = require('regression');
const http = require('http');

// Define API URLs.
const host = 'http://oec-2018.herokuapp.com';
const api_key = 'bNNBNDovb7y8eiMGYAlm_Q';
const url_stock_list = `/api/stock/list?key=${api_key}`;
const url_account_status = `/api/account?key=${api_key}`;
const url_current_price = symbol => { return `/api/stock?ticker=${symbol}&key=${api_key}`; };
const url_buy_stock = (symbol, shares) => { return `/api/buy?ticker=${symbol}&shares=${shares}&key=${api_key}`; };
const url_sell_stock = (symbol, shares) => { return `/api/sell?ticker=${symbol}&shares=${shares}&key=${api_key}`; };

// Define constants that determine the bot behaviour.
const short_term_history = 30;
const long_term_history = 100;
const short_term_weight = 0.8;
const long_term_weight = 0.2;
const max_trade_volume = 3;
const buy_symbol_count = 6;
const sell_symbol_count = 15;
const trade_interval = 60;

// Create a variable to store the market state.
const market = { symbols: [], prices: {}, portfolio: {} };

// Log the bot startup.
console.log('Botcoin started!');

// Create a function to call any API endpoint.
const get = function (url) {
    // Create a new promise that will resolve then the request is completed.
    return new Promise((resolve, reject) => {
        // GET the URL.
        request.get({ url: (host + url), json: true }, (error, response) => {
            // Reject on error.
            if (error) reject(error);
            // Otherwise, resolve the promise.
            else resolve(response.toJSON().body);
        });
    });
};

// Create a function to update the stored state of the entire market.
const updateMarketState = function () {
    // Create a promise that will resolve when the state is up to date.
    return new Promise((resolve, reject) => {
        // Get the current account status.
        get(url_account_status).then(result => {
            // Check if the call worked.
            if (result.success) {
                // Store the amount of cash held.
                market.portfolio.cash = result.cash;
                // Store the stocks held.
                market.portfolio.holdings = result.holdings;
                // Get the list of stocks.
                get(url_stock_list).then(result => {
                    // Check if the call worked.
                    if (result.success) {
                        // Store the symbols.
                        market.symbols = result.stock_tickers;
                        // Create an object to store the prices.
                        market.prices = {};
                        // Create an object to store the promises.
                        const promises = [];
                        // Iterate through the symbols.
                        market.symbols.forEach(symbol => {
                            // Get the price of the symbol.
                            const promise = get(url_current_price(symbol)).then(result => {
                                // Store the result.
                                if (result.success) market.prices[symbol] = result;
                            });
                            // Push the promise.
                            promises.push(promise);
                        });
                        // Add a callback for when all the promises resolve.
                        Promise.all(promises).then(values => {
                            // Resolve the calling promise.
                            resolve(market);
                        });
                    }
                });
            }
        });
    });
};

// Create a function to do the regression.
const doRegression = function (price_data, number_of_points) {
    // Map the prices to points in 2D.
    const points = price_data.historical_price.map((value, index) => { return [index, value] });
    // Return the result.
    return regression.linear(points.slice(points.length - number_of_points, points.length));
};

// Create a function to evaluate the networth of our portfolio.
const evaluatePortfolio = function () {
    // Get the amount of liquid cash.
    const cash = market.portfolio.cash;
    // Store the holdings.
    const holdings = market.portfolio.holdings;
    // Initialize a total count.
    let market_value = 0;
    // Create an object to store flags marking symbols as held.
    market.portfolio.held = {}
    // Iterate through the holdings.
    holdings.forEach(holding => {
        // Count their value.
        market_value += holding.market_value;
        // Flag them as held.
        market.portfolio.held[holding.ticker] = true;
    });
    // Return a status update.
    return { cash: cash / 100, investment: market_value / 100, total: (cash + market_value) / 100 };
}

// Define one buy / sell cycle.
const do_cycle = function () {
    // Update the market state.
    updateMarketState().then(market => {
        // Store the portfolio status.
        const portfolio = evaluatePortfolio();
        // Create a list for short term trades.
        const short_term_symbols = [];
        // Create a list for long term trades.
        const long_term_symbols = [];
        // Iterate through the symbols.
        market.symbols.forEach(symbol => {
            // Get the price data.
            const price_data = market.prices[symbol];
            // Evaluate the regressions.
            const short_term_value = doRegression(price_data, short_term_history);
            const long_term_value = doRegression(price_data, long_term_history);
            // Store the short term and long term symbols.
            short_term_symbols.push({ symbol: symbol, slope: short_term_value.equation[0] });
            long_term_symbols.push({ symbol: symbol, slope: long_term_value.equation[0] });
        });
        // Sort the symbols by slope.
        short_term_symbols.sort((a, b) => { return a.slope - b.slope; });
        long_term_symbols.sort((a, b) => { return a.slope - b.slope; });
        // Compute market entrance strategies.
        const entrance_strategies = {};
        for (let i = short_term_symbols.length - buy_symbol_count; i < short_term_symbols.length; i++) {
            // Short term entrances.
            if (entrance_strategies[short_term_symbols[i].symbol]) entrance_strategies[short_term_symbols[i].symbol] += short_term_weight * short_term_symbols[i].slope;
            else entrance_strategies[short_term_symbols[i].symbol] = short_term_weight * short_term_symbols[i].slope;
            // Long term entrances.
            if (entrance_strategies[long_term_symbols[i].symbol]) entrance_strategies[long_term_symbols[i].symbol] += long_term_weight * long_term_symbols[i].slope;
            else entrance_strategies[long_term_symbols[i].symbol] = long_term_weight * long_term_symbols[i].slope;
        }
        // Compute market exit strategies.
        const exit_strategies = {};
        for (let i = 0; i < sell_symbol_count; i++) {
            // Short term exits.
            if (market.portfolio.held[short_term_symbols[i].symbol]) {
                if (exit_strategies[short_term_symbols[i].symbol]) exit_strategies[short_term_symbols[i].symbol] += short_term_weight * short_term_symbols[i].slope;
                else exit_strategies[short_term_symbols[i].symbol] = short_term_weight * short_term_symbols[i].slope;
            }
            // Long term exits.
            if (market.portfolio.held[long_term_symbols[i].symbol]) {
                if (exit_strategies[long_term_symbols[i].symbol]) exit_strategies[long_term_symbols[i].symbol] += long_term_weight * long_term_symbols[i].slope;
                else exit_strategies[long_term_symbols[i].symbol] = long_term_weight * long_term_symbols[i].slope;
            }
        }
        // Normalize the slopes based on the unit price of each stock to determine a buy or sell volume.
        for (symbol in entrance_strategies) {
            const unit_price = market.prices[symbol].price;
            entrance_strategies[symbol] *= 100;
            entrance_strategies[symbol] = Math.max(0, Math.min(entrance_strategies[symbol], max_trade_volume));
            entrance_strategies[symbol] = Math.round(entrance_strategies[symbol]);
        }
        for (symbol in exit_strategies) {
            const unit_price = market.prices[symbol].price;
            exit_strategies[symbol] /= unit_price;
            exit_strategies[symbol] *= 100;
            exit_strategies[symbol] = Math.min(0, Math.max(exit_strategies[symbol], -max_trade_volume));
            exit_strategies[symbol] = Math.abs(Math.round(exit_strategies[symbol]));
        }
        // Log the current portfolio status.
        console.log('Current account status:', portfolio);
        // Execute the strategies.
        for (symbol in entrance_strategies) {
            if (entrance_strategies[symbol] == 0) continue;
            console.log(`Buying ${entrance_strategies[symbol]} share(s) of ${symbol}.`);
            // get(url_buy_stock(symbol, entrance_strategies[symbol]));
        }
        for (symbol in exit_strategies) {
            if (exit_strategies[symbol] == 0) continue;
            console.log(`Selling ${exit_strategies[symbol]} share(s) of ${symbol}.`);
            // get(url_buy_stock(symbol, entrance_strategies[symbol]));
        }
        console.log('Done one cycle!\n');
    });
}

// Do one cycle.
do_cycle();
// Run the cycles on a regular interval.
setInterval(do_cycle, trade_interval * 1000);

// Create a request handler.
const requestHandler = (request, response) => {
    response.end('Hello Botcoin Server!');
};

// Create a server.
const server = http.createServer(requestHandler);
// Start the server.
server.listen(process.env.PORT || 3000);
