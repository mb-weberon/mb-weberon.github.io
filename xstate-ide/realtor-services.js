export const realtorServices = {
    getMarketRate: async (data) => {
        // Mock a 1.5s delay to represent a real API call
        await new Promise(resolve => setTimeout(resolve, 1500));
        return (6.5 + Math.random()).toFixed(2) + "%";
    }
};
